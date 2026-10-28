# Second-round Firestore read audit

Date: 2026-10-28 (Asia/Singapore). Branch: `optimize-firestore-reads-round-two`.
No merge, push, deployment, Firestore rules, indexes, schema, dependencies, or backend writes were performed.

## Baseline and scope

The starting worktree was clean. Audited frontend Firestore calls, API consumers, React subscription effects, backend query sites, authentication middleware, scheduling transactions, background workers, notification loading, pricelists, account management, and the Groq request path. This is a static query audit plus mocked behavioral testing, not a production billing measurement. No production database queries were issued for measurement.

The pre-change full-suite attempt is recorded in `round-two-baseline-tests.log`. It exposed failures and a Vite transport timeout and was interrupted when it stopped making useful progress. A sequential full-suite retry uses a 15-second per-file timeout; see `round-two-full-tests.log`. The optimization-specific tests run independently of Vite.

| Priority | Finding before changes | Decision |
| --- | --- | --- |
| High impact, moderate risk | Appointments and pets: complete API reload every 10 seconds after completion, plus full reloads triggered by a 200-document listener | Admin/staff now consume complete Firestore snapshots directly. No periodic API reload while the listener is authoritative. Retain complete API fallback on denied listener access. |
| High impact, moderate risk | Availability: forced complete API reload every 60 seconds, up to ten 200-document pages, plus focus refreshes | Replace healthy-path polling with one complete listener. Preserve the existing API fallback interval on listener failure. |
| High impact, high security risk | Session monitor: 2-second timer plus navigation, activity and browser/network events | Keep the security interval and event checks. Drop redundant timer ticks during an outstanding verification. No authorization cache. |
| Lower current impact | Multiple callers could create identical subscription resources | Share by Firebase user object, collection, owner filter, expected UID and subscription mode; release on last unsubscribe. |
| High risk of incomplete data | Customer API combines canonical and legacy ownership, while customer listener covers canonical ownership only | Preserve customer full API polling and legacy recovery. |
| High risk of missing data | Global consumers use appointments, pets and availability across dashboards, booking flows and shared counters | Preserve global subscriptions and existing effect dependencies. |

## Changes

- `src/app/services/scheduleData.js`: reference-counted shared subscriptions; complete admin/staff appointment and pet listeners; complete availability listener; server/cache metadata handling; existing polling as an access-error fallback; guards against callbacks after cleanup/account change; prevent slow fallback responses from overwriting live snapshots; availability cache generation guards and invalidation after writes/logout.
- `src/app/context/AppContext.jsx`: enable complete snapshots only for admin/staff. Customer behavior remains on the legacy-compatible API path.
- `src/app/services/sessionSecurityMonitor.js`: timer ticks do not queue another request while one is already pending. Browser/network events retain the queued follow-up behavior.
- `tests/schedulePersistence.test.mjs`: extend dependency-port fixture and behavior coverage for sharing, complete datasets, edits/deletions, fallbacks, cleanup, account changes and response races.
- `tests/sessionSecurityMonitor.test.mjs`: test slow-request timer deduplication alongside existing role/navigation/network/revocation coverage.
- Audit logs and this report are under `artifacts/firestore-read-audit/`.

Firestore handles incremental server document delivery for these listeners; mapping the current snapshot into the existing array data structure does not reread all documents from the server. Complete queries deliberately retain old records, records without dates, legacy slot IDs and closed-slot tombstones. No range filter or limit was applied that could hide records needed by current global consumers. An initial complete snapshot still costs a complete result read, and reconnects can also incur reads.

## Read and request calculations

Normal successful protected API request, with a canonical user profile and a session ID:

1. `authenticate.js` -> `getUserByUid`: one `users` document read.
2. `validateSessionSecurity`: one `sessionSecurity` read before the external IP lookup.
3. Another `sessionSecurity` read after the lookup, to detect revocation while it was running.
4. One `sessionConnections` read.

Thus the usual overhead is **four application-level Firestore document reads per protected API request**, before reading endpoint data. Without a session ID it is three. Missing canonical profiles add a legacy lookup; revocation paths and retried transactions add reads. Firebase Auth token verification and external IP provider requests are separate operations, not Firestore document reads.

At a nominal uninterrupted 2-second interval, the session timer alone allows approximately 1,800 requests/hour, or 7,200 normal application-level Firestore reads/hour. Actual throughput depends on request duration, visibility, errors and browser scheduling; activity can add checks. This security cost is intentionally retained. Two revocation reads are not treated as duplicate reads because they bracket a potentially slow external lookup.

For a staff/admin collection with N documents and P API pages (500 records/page), one former full API load reads approximately `N + (P - 1) + 4P` documents: N results, pagination lookahead duplicates, and per-page authorization. Empty queries have minimum query charges, not captured by that simplified expression. The 10-second-after-completion loop can approach 360 such full loads/hour; listener changes and focus events added more loads.

After the change, a healthy complete subscription reads its initial dataset, then changed documents, plus Firestore rule-dependent reads and possible reconnect charges. It makes **zero periodic record API requests while authoritative**. It still permits explicit refresh actions and uses the former interval on listener failure. This replaces repeated full-result reads with change-driven reads; it does not eliminate the initial result read.

Availability formerly approached 60 complete API passes/hour. With S slots and P pages (200 slots/page, at most 10), each pass similarly reads roughly `S + (P - 1) + 4P`, within the old page cap. The new healthy listener performs one initial complete query and then change delivery, with zero periodic availability API calls. For more than 2,000 slots, the new query can have a larger initial read than the old capped load; it preserves complete synchronization rather than silently dropping additional slots.

For illustration only, an unchanged 1,000-slot dataset requires five API pages: approximately 1,024 application reads per prior pass, or 61,440 over 60 passes. A healthy listener instead starts with 1,000 document results, followed by change/reconnect/rule costs. This is a model, not measured production savings. No reduction percentage is claimed.

Measured mocked behavior: two availability consumers use one listener; three authoritative snapshots (open, closed, deleted) and a focus event produce zero availability API calls and zero polling timers. A listener error starts one API request and restores one fallback timer. A complete 550-record appointment snapshot is retained without API requests. Slow verification timer ticks add zero queued requests; a later tick still checks. These counts describe test requests, not billable reads.

## Security and consistency

All protected write endpoints, ownership checks, account/fraud restrictions, Firebase token revocation checks, session IP checks and transaction-based slot capacity validation remain unchanged. No successful authorization result is reused across API requests. Existing Firestore rules remain the authority for direct listeners; denied listeners use authenticated API reads. The session timer and immediate network/browser checks remain active.

Only server-confirmed snapshots stop polling. Cache-only snapshots initiate API fallback rather than hydrating potentially incomplete data. Metadata events allow an unchanged cached result to transition to a confirmed server result. Last-consumer cleanup releases listeners, timers and event handlers. Old-account callbacks and slow fallback results cannot overwrite live subscription state. Slot updates continue through the original backend transactions, which trigger listener updates.

Simultaneous booking safety was inspected in the existing transaction implementation, not demonstrated against a live multi-user database. A pre-existing slot-capacity test failure prevents claiming the full booking suite is green.

## Other audited areas and deliberately retained reads

- Authentication/customer accounts: canonical-profile lookup plus legacy fallback and existing client cache/recovery logic. Retained fresh server profile reads for suspension, role and account restrictions. No TTL authorization caching.
- Admin/staff dashboards: existing UID/role-dependent effects stay mounted; complete shared listeners now supply record updates. No navigation, reducer or presentation changes.
- Customer appointments/pets: canonical, `ownerId`, and email ownership queries can overlap. Retained because eliminating a lookup without migration or equivalent query coverage could lose legacy records. Backend ownership conflict filtering remains unchanged.
- Booking/approval/cancellation: all transaction reads retained. Staff conflict queries, slot capacity, promo validation, pet checks, reservation updates and notifications are correctness checks, not redundant cache candidates.
- Availability: date-range restriction deferred because the current global API provides no selected calendar range and existing forecasts/closed-slot overrides depend on legacy entries. Supporting a range safely requires tracing and changing all consumers; this patch instead removes repeated full loads on the healthy path.
- Notifications: bounded recent queries (50 plus lookahead) and existing older-page fetching retained. Current notification subscription helper is focus-based, not a true continuous listener; this pre-existing behavior was not changed as part of read reduction.
- Product catalog, inventory, online orders/payments, POS, sales/reports: no implemented database-backed flows for these modules were found in the supplied application source. They cannot be exercised or optimized in this checkout.
- AI chatbot: Groq controller/service forwards chat requests and streams responses; no Firestore reads found on that path. Static service/catalog content is not a repeated Firestore collection query.
- Pricelists: existing frontend request deduplication/cache retained. Backend reads category documents transactionally for safe initialization; no cross-user TTL caching added. Cross-tab focus refresh remains.
- User management: bounded list queries and write-time identity/permission checks retained; missing pagination beyond current limits is a completeness concern, not safely fixed by reducing reads further.
- Background reminders: today's appointments are queried every minute with transactional delivery claims. This remains a potential high-read area; changing timing/filtering could alter reminder delivery and require indexes or new time fields.
- No-show worker: active due records are paged every five minutes; repeated eligible-but-not-transitioned records can cost reads. Status/lifecycle changes were outside this optimization.
- OTP, registration-attempt limits, username/phone uniqueness, pending-registration cleanup: transaction/lookup reads retained to preserve lockout, uniqueness and cleanup behavior.

## Verification and limitations

- Optimization-specific suite: **20 passed, zero failed**. Command: `node --test --test-concurrency=1 tests/sessionSecurityMonitor.test.mjs tests/schedulePersistence.test.mjs`.
- Backend security/schedule/reminder suite: **44 passed, one failed**. Failure: `Pending appointments reserve slot capacity and cancellations free the slot`. The same failure appears in the pre-change log; backend production code is unchanged.
- Production build passed; the final build including cache-generation guards took **20.41 seconds**. This is compilation duration, not measured page responsiveness. Generated tracked `dist` files were restored; the final build output is in a temporary directory.
- `git diff --check` passed.
- Full-suite retry: **258 tests, 234 passed, 23 failed, one cancelled**, in 297.3 seconds. Failures existed before changes, including lifecycle/status expectations, employee/profile password expectations, registration tests, promo subscription mocks and Vite transport errors. The older Vite schedule-data fixture also lacks browser globals and expects an obsolete token-refresh retry; its failures remain documented rather than weakening assertions or changing production behavior to satisfy it. The newer dependency-port suite tests the current behavior. The full retry started before the final cache-generation/error guards and last added focused test; the focused suite was rerun on final sources. Do not treat the full application as verified green.
- No before/after browser performance timings, Firebase usage telemetry, emulator rules tests, live admin/staff/customer login, actual suspension/revocation, simultaneous booking, multi-user updates, real offline/reconnect, payment/POS transactions or live Groq calls were performed. Browser focus, cleanup, role monitoring, account changes, access-denial fallback and stale-response races have mocked coverage only.

Deployment remains subject to user permission and live staging verification, particularly actual Firestore claims/rules, suspension/revocation, concurrent booking and reconnect behavior. When deployed rules deny a new complete listener, the existing authenticated API behavior remains available, so savings depend on successful listener access.
