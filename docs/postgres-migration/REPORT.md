# PostgreSQL migration preparation report

Branch: `migrate-firestore-to-postgres-staging`. Date: 2026-10-28, Asia/Singapore.

**Status: opt-in local implementation and staging tools prepared. Hosted migration
and production cutover have not occurred.** Firebase remains the default provider.
No production data was exported, imported, changed or deleted. No push, merge or
deployment was performed. Existing uncommitted optimization/configuration changes
were preserved when creating this branch.

## Implemented architecture and files

| Files | Purpose |
| --- | --- |
| `server/src/database/collections.js` | Verified 24-collection allowlist and SQL table mapping |
| `server/src/database/values.js` | Lossless timestamps (including nanoseconds), bytes, references, geography, non-finite numbers and reserved-map escaping |
| `server/src/database/postgres.js` | Pooled SQL provider; parameterized queries; snapshots, batches, merge/update, transaction lock and bounded retry handling |
| `supabase/migrations/202610280001_business_data.sql`, `202610280002_public_relational_tables.sql` | Private document/archive schema plus the supplied public UUID tables, relational keys, foreign-key links, compatibility views, indexes, RLS and restricted change events |
| `server/src/database/browserAccess.js` | Explicit read/write authorization; legacy ownership; self-profile restrictions; no generic booking/employee/promo transaction bypass |
| `server/src/routes/database.routes.js` | Firebase-verified document API and five-minute restricted Realtime token exchange |
| `server/src/config/firebaseAdmin.js` | Select PostgreSQL only when explicitly configured; retain Firebase Admin Authentication |
| `server/src/app.js` | Database route, provider mismatch guard and explicitly configured HTTPS/WSS Supabase CSP origins |
| `src/app/services/database.js` | Provider facade; Firestore remains the default |
| `src/app/services/postgresBrowser.js` | Authorized data requests, snapshots, per-user cache and Supabase change synchronization |
| `src/app/services/databaseToken.js`, `src/supabaseClient.js` | Shared token exchange; Firebase-session-aware cache; custom authenticated Realtime client |
| `src/firebase.js` | PostgreSQL mode avoids initializing a Firestore database; retains Firebase Auth, Storage and Analytics |
| `src/app/services/scheduleData.js` | PostgreSQL subscriptions use complete server-authorized records, including customer legacy ownership; shared appointments/pets/availability and notifications |
| `src/app/services/customerAccount.js`, `firebaseAuth.js` | Database facade for profile reads/writes; validated backend registration for PostgreSQL profile creation |
| `src/app/services/kaponPromo.js` | PostgreSQL realtime promo reads and existing transactional promo API for writes |
| `src/app/services/apiClient.js` | Client/server provider header prevents normal Axios requests against a mismatched provider |
| `src/app/context/AppContext.jsx` | Add PostgreSQL notification synchronization; retain existing global state and UI consumers |
| `server/scripts/postgresMigration.js` | Read-only recursive export, staging schema/import, checksums, idempotency, aggregate validation and relationship checks |
| `server/scripts/auditDatabaseCalls.js`, `database-call-inventory.json` | Reproducible source call-site inventory (267 sites; nearest declaration is a navigation hint) |
| `tests/postgresMigration.test.mjs`, `postgresApi.test.mjs`, `postgresRealtime.test.mjs` | SQL engine, controllers, migration, API, authorization and realtime tests |
| Root/server `package.json` and lockfiles | Server `pg`, development-only PGlite test engine and migration commands; pre-existing Supabase dependency retained |
| `.gitignore` | Additional defensive backup-file exclusions |
| This directory and `artifacts/postgres-migration/` | Plan, setup template, runbook, inventory and aggregate test/build evidence |

The previously edited session-security monitor and read-optimization tests remain
in the worktree from the earlier task; this migration does not change their
security cadence. Tracked vendor/build files modified by installation/builds were
restored. Build outputs are outside the repository in the system temporary path.

## Tables, relationships and compatibility

The collection-to-table mapping is authoritative in `collections.js` and the
inventory. The supplied `public.users`, `pets`, `services`, `appointments`,
`products` and `orders` tables are the active relational rows. `legacy_id` keeps
the existing Firebase document ID and `legacy_data` preserves fields which do not
have a native column. Compatibility views supply the existing document API, so
current frontend and controller payloads remain unchanged while UUID foreign keys
connect users, pets, appointments, services and orders. Appointment multi-service
selection is retained in `public.appointment_services`. Separate private tables cover usernames, deleted
pets/availability, notifications/photo moderation, promotions/details/pricelists,
sessions/revocation, OTPs/authentication attempts/phone locks, and all collection
names referenced by the existing rules: customers, services, chatbot FAQs,
timeSlots, slotManagement, schedules, slot_management and revoked_tokens.

There are **20 private document tables**, six public relational tables,
`public.appointment_services`, `app_private.firestore_archive` and
`public.database_changes`. Original document IDs remain stable text compatibility
keys alongside native UUID primary keys; nested and optional fields remain JSONB.
The archive preserves full paths of unknown
collections and subcollections, including descendants of missing parents. No
runtime subcollection use was found in supplied source; a live export has not
been run to discover additional stored collections.

Owner UID/email, pet ID, slot ID, notification target, OTP user and username UID
relationships remain compatible with existing documents. Queries use dedicated
expression/composite indexes and primary-key cursor pagination. Hard foreign keys
are deliberately deferred: legacy email ownership, forecast slots, retained visit
history and deleted-pet tombstones can legitimately lack canonical parents.
Validation flags discrepancies for review rather than losing records through
guessed constraints or fabricated parents. SQL constraints currently enforce IDs
and document shape; existing backend controllers enforce business transitions.

## Converted operations and real-time behavior

All verified backend collection/query/document, batch and transaction call sites
use the selected provider through the existing configuration boundary. Controllers
keep their original rules and response shaping. The implemented adapter covers
the operators found in source: equality/inequality, ranges, `in`, ordering, limits,
cursors, document reads, `getAll`, set/merge/update/delete, batches and transactions.
Unsupported collections/operators fail rather than silently querying a fallback
database. Firebase SDK Auth operations and Storage are intentionally retained.

The frontend facade covers the four Firestore service modules. Appointments,
pets, availability, promos and notifications have PostgreSQL listener paths.
Subscriptions establish before initial fetch, queue intervening changes, recover
by resnapshotting on reconnect, fetch affected documents for complete collection
updates, and release channels on cleanup. Filtered/limited notification queries
reload only their bounded result to reconcile page boundaries. Backend queries
continue to enforce owner and role access.

Supabase publishes **insert-only minimal change events**, not private documents.
That supports deletions and ownership transfers while avoiding the authorization
limitations of directly consuming deleted business rows. RLS checks current
account/fraud status, role, UID and original Firebase token revocation cutoff.
The backend mints short-lived `authenticated` JWTs without changing Firebase's
admin/staff/customer role claims. A real staging project must accept the configured
JWT signing method before hosted realtime can be considered verified.

## Data validation and security evidence

Synthetic migration test: three documents, including one unknown nested path,
imported twice; **three verified, zero missing, zero mismatched, zero unexpected**
on the initial validation. A deliberately changed payload produces a mismatch;
a deliberately changed backup fails checksum verification. Timestamp nanoseconds,
byte arrays, nested maps/arrays and original IDs round-trip in SQL tests.

No real customer data or production counts were measured. Production data
consistency is **not** certified by these synthetic results. The validator also
checks missing owner/pet/slot/username relationships, duplicate email/UID values,
invalid roles, invalid pet genders and invalid capacity values. Outputs contain
aggregate counts only; backup/manifest files must be outside the checkout.

Security tests verify anonymous/private-table denial, customer event isolation,
immediate RLS suspension/revocation denial, cross-owner API denial, role-escalation
denial, no generic booking-write bypass, restricted notification acknowledgement,
profile credential redaction, Firebase-token verification invocation and restricted
Realtime token claims. Existing OTP tests run against PostgreSQL for lockout and
one-time consumption. Live Firebase token verification remains the existing SDK
implementation; the HTTP tests supply a mocked verifier, not real customer tokens.

Credential scan of **78 generated JS/HTML files across both builds found zero
matches for configured privileged credentials**. This is a check of known local
secrets, not an independent security audit. `.env` remains ignored. Service-role
keys, JWT signing secrets and SQL credentials are never used as browser keys.

## Automated verification

- Final relational migration/API/realtime checks: **12 passed, zero failed**.
  They include idempotent import/validation, relational table writes, existing
  booking/pet controllers, authorization and listener recovery.
- SQL tests execute the actual PostgreSQL engine through PGlite. Existing pet
  and booking controllers successfully persist/update/delete data. Two competing
  booking calls at capacity one yield one success and one 409 conflict.
  **PGlite uses one serialized session: separate connections, replicas and hosted
  lock contention are not verified by this test.**
- Existing OTP consumption and account lockout logic is exercised with SQL storage.
- Additional backend Auth HTTP/environment/security/schedule/reminder checks:
  **46 passed, one failed**. The known `Pending appointments reserve slot capacity
  and cancellations free the slot` fixture failure also predates this migration.
- Both production frontend builds passed after relational adaptation: Firestore
  mode **21.36 seconds**, PostgreSQL mode **21.06 seconds**. These are build durations, not browser latency
  benchmarks, and are not evidence of a runtime speedup.
- Full-suite rerun recorded **270 tests: 246 passed, 23 failed and one cancelled**
  in 181.3 seconds. The failure names match the pre-migration full-suite failures.
  See `artifacts/postgres-migration/full-tests.log`. Final SQL normalization and
  notification-policy assertions were additionally checked with the focused suite.
- `git diff --check` passed. New backend JavaScript syntax checks passed.

Existing suite failures include lifecycle/status expectations, old browser mocks,
registration/password expectations and a timed-out schedule-data test. They were
not silenced or rewritten to claim a green migration. A green build plus targeted
tests does **not** certify complete feature equivalence.

## Remaining gates and limitations

1. The supplied Supabase URL is the Express `/api` origin, not a verified Supabase
   API/websocket endpoint. A real staging URL, PostgreSQL connection string and
   accepted JWT signing configuration are still required privately. No hosted
   schema, import, Realtime subscription or RLS integration has been exercised.
2. Live registration/activation/mail/OTP, real admin/staff/customer login,
   password and email changes, role changes, suspension/revocation, notification
   delivery, approval/session lifecycle, photo moderation, promo/pricelist edits,
   chatbot and actual offline/multi-tab synchronization need staging browser tests.
3. No implemented inventory, catalog ordering, payments, POS or sales/report
   database flows were found. No such functionality was invented or certified.
4. The conservative transaction-wide write advisory lock makes the existing
   read/check/write controllers safe across participating SQL writers, including
   phantom booking queries. It serializes **all** application writes and may limit
   throughput. Tune only after multi-connection contention tests; direct SQL writers
   outside this adapter must obey the same lock protocol.
5. Event rows need a scheduled admin-only retention job and Free-plan storage/
   replication monitoring. No scheduler has been installed in a hosted project.
6. Export is sequential, not a source-wide snapshot. Final migration needs an
   approved write freeze or consistent point-in-time source. The migration CLI
   refuses non-staging imports; production tooling/procedure must be reviewed
   separately after explicit approval.
7. No production data size, latency, resource usage or billing comparison exists.
   Pool size defaults to five, API reads are bounded/paged, authorization remains
   uncached and realtime bootstrap requests are shared. Performance preservation
   remains a staging acceptance criterion, not a claimed result.
8. The generic browser API intentionally cannot create privileged accounts, change
   restrictions or run arbitrary client transactions. Account creation uses the
   existing validated registration endpoint. Review legacy automatic profile-repair
   cases during staging; do not loosen restrictions to accommodate corrupt records.
9. Forward-only staged imports are idempotent and atomic. There is no automatic
   reverse migration after PostgreSQL begins accepting writes. Rollback after
   that point requires a frozen, backed-up, separately validated reconciliation.

Follow [RUNBOOK.md](RUNBOOK.md) for private setup, schema application, backup,
staging transfer, required manual tests and approved-cutover/rollback procedures.
Do not switch the live providers or transfer production records until those
gates pass and the user explicitly approves.
