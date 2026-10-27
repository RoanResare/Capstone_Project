# Firestore read optimization audit

Branch: `optimize-firestore-reads`. No deployment, push or merge performed.

## Scope and findings

Inspected frontend Firestore/API services, AppContext subscription lifecycle, authentication middleware, session security service, schedule/pet/appointment controllers, record pagination, background jobs, rules, indexes and available tests. No credentials were opened or used. This is a static audit with mocked regression tests, not a production billing or full browser audit.

Ranked recurring costs:

1. `sessionSecurityMonitor.js`: visible sessions check every 2 seconds, plus navigation/activity/focus events. An ordinary protected request reads the user profile, revocation document twice around asynchronous network validation, and connection document when a session ID exists. Approximately 3–4 Firestore document reads per request, excluding missing-profile fallbacks, violations and Firebase Auth RPCs. At 30 interval checks/minute this is approximately 90–120 reads/minute per visible session before other events. **Unchanged**: increasing intervals or caching permission/revocation data changes enforcement timing. Both revocation checks bracket an asynchronous operation; removing one can miss a concurrent revocation.
2. `scheduleData.js`: appointments and pets each reload all accessible API records every 10 seconds while also listening to the latest 200 IDs. Portal API pages fetch 501 documents and return 500. Customer queries separately retrieve customerId, ownerId and legacy email matches and deduplicate results. Overlapping callers previously repeated all pages and protected-request checks. This is the implemented optimization target.
3. Limited schedule listeners trigger complete API reloads. Removing polling is unsafe: modifications outside the listener's 200-document window and legacy customer ownership can be missed. Listener permission-denial fallback must remain. Polling frequency and listener queries remain unchanged.
4. Availability uses paginated API reads every 60 seconds and on focus/visibility events. Concurrent refresh callbacks could each install a polling timer after sharing one request, leaving multiple future timer chains. Fixed overlapping refresh execution within each subscription.
5. Notifications use bounded queries (50 customer / 51 portal), existing short-lived caches and pagination. AppContext currently loads notifications without a continuous snapshot subscription; its local refresh function is unused. Promotion updates are also cache/focus driven. These existing synchronization limitations are not introduced or repaired here; changing them requires separate functional coverage and would increase listener reads.
6. Reminder/no-show jobs query due appointments; reminder processing uses transaction-based delivery records. Authentication, registration, OTP, ownership and booking-capacity transaction reads protect correctness and remain unchanged.
7. Product catalog data in `Products.jsx` is static. No dedicated inventory, ordering, payment, POS or sales Firestore service/routes were identified in this checkout. Those requested live workflows cannot be verified here. Chatbot uses the Groq proxy and supplied clinic context; no repeated Firestore query was found in that request path. Dashboard record consumption flows through AppContext.

## Changes

- `src/app/services/scheduleData.js`: share only pending complete appointment/pet API reads for the same Firebase user object and collection. Preserve all pagination, authorization headers and account-change checks. Evict on success or failure; do not retain completed responses. A later call always fetches again.
- Clear pending-sharing entries on affected collection invalidation and logout cache clearing. Identity-checked cleanup prevents completion of an old request from removing its replacement.
- Serialize overlapping availability refreshes and clear the previous timer before starting a new refresh. Keep the existing interval, callback data, error path, account guard and unsubscribe cleanup.
- `tests/schedulePersistence.test.mjs`: add meaningful concurrency, pagination, freshness, invalidation, account isolation, retry and availability timer regression tests.
- No UI, backend authorization, rules, indexes, schema, API contracts, transaction logic or business workflows changed.

## Before/after evidence

For two simultaneous portal loads of 550 records:

| Metric | Before | After |
| --- | ---: | ---: |
| API page requests | 4 | 2 |
| Estimated returned Firestore query documents | 1,102 | 551 |
| Records delivered to each caller | 550 | 550 |

The new test measures two page requests after the change; the pre-change loader independently issues two pages per caller. This supports a 50% reduction **for that overlapping pair only**, including associated per-page authentication reads. A subsequent load performs both pages again and sees newly added records. For k overlapping loads, request count changes from kP to P for P pages. There is no supported project-wide percentage or measured billing reduction. Ordinary non-overlapping periodic loads have unchanged read cost.

Availability tests demonstrate one request and one timer for overlapping focus events, with cleanup removing that timer. This prevents duplicate future polling chains without changing the intended 60-second cadence. No latency benchmark was performed; deduplication adds no waiting interval or TTL and reduces duplicate work.

## Verification

- Baseline: invoked `node --test tests/*.test.mjs server/tests/*.test.js` before editing. Existing failures appeared across booking lifecycle, registration, remembered device, promo/UI, text validation and profile tests. The broad run did not finish; see `baseline-tests.log`.
- Post-change broad run: invoked `node --test --test-timeout=30000 tests/*.test.mjs server/tests/*.test.js`. It also did not yield a completed suite summary at audit time. Do not interpret partial output as a passing suite. See `optimization-tests.log`.
- Targeted existing security/schedule suite: **54 passed, 1 failed**, total 55. The failure, `Pending appointments reserve slot capacity and cancellations free the slot`, also appeared in baseline output. Tests covered session monitoring, revocation, permissions, ownership, booking conflicts, slot capacity and schedule record access. See `optimization-targeted.log`.
- Final schedule regression run: **9 passed, 0 failed**. Covers all-page loading beyond 200, customer-only filtering, saved-profile reload, listener-denial polling fallback, deduplication, subsequent freshness, failed-request retry, invalidation/logout/account changes, and availability timer cleanup. See `optimization-dedup-tests.log`.
- Production build: `npm.cmd run build` **passed**, 38.59 seconds. PowerShell blocks `npm.ps1`; using `npm.cmd` required no policy change. Generated dist modifications were restored/removed. See `optimization-build.log`.
- `git diff --check` passed.
- Live customer booking/approval, simultaneous real Firebase transactions, inventory/order/payment/POS, cross-browser notifications, real suspension/login/logout and live AI responses were **not executed**. No production database measurements or network capture were taken. Existing mocked checks do not establish complete end-to-end equivalence.

## Safer next steps

1. Repair pre-existing failing/hanging tests before using the full suite as a release gate.
2. Collect Firestore usage and authenticated network traces for representative admin/staff/customer sessions. Separate document reads, rule-dependent reads, Auth RPCs and query/index billing.
3. Prototype complete incremental schedule synchronization with explicit legacy ownership coverage and denied-listener recovery in an emulator. Only then replace whole-record polling; keep transactional booking validation authoritative.
4. Add browser/emulator coverage for suspension, concurrent bookings, notifications and account switching before considering security-monitor coalescing or polling changes. Do not cache permission or revocation decisions to achieve read savings.
5. No new query/index requirement is introduced by this change. Verify existing composite query indexes in staging before changing query shapes or historical pagination.

This is a conservative reduction of duplicate work. Significant overall savings and 100% functional equivalence have not been established; the largest recurring costs deliberately remain until a safely testable replacement exists.
