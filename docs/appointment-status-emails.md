# Appointment status emails

## Scope and storage

Admin/Staff Pending -> Approved (including existing Accepted/Confirmed aliases), Pending -> Rejected, and Pending/Approved -> Cancelled decisions queue a transactional email. Slot closure cancellations use the same mechanism. Customer cancellations, views, realtime updates, unchanged status edits, new bookings, Completed and No Show do not queue these staff-decision emails. Existing status transitions, reasons, authorization and booking capacity rules are unchanged.

**Supabase SQL required: none.** The implementation reuses the existing private `app_private.appointment_reminders` JSONB delivery ledger through the `appointmentReminders` adapter. Status jobs have `status-mail-<event UUID>` IDs and `notificationType: appointment-status-email`; reminder keys and worker queries remain untouched. Existing `retryAt` indexing and private-table access controls apply. A local PostgreSQL integration test applies the original migration unchanged and verifies queue persistence, rollback, worker queries and reminder isolation. No production SQL, schema changes, permission changes or historical backfill is performed.

An outbox job and the appointment decision commit in one existing PostgreSQL transaction. The adapter serializes application writes across replicas; a request retried after a committed status transition observes the existing status and creates no new event. Transaction retries discard uncommitted jobs. Delivery is never run inside the appointment transaction or as synchronous email work in the HTTP request.

## Recipient and content

The job binds the customer ID from the previously stored appointment, never a request email address. At delivery, the server resolves that customer's current profile, requires the customer role, active eligibility and a valid address, and checks the confirmed Supabase identity/address when linked. Unlinked legacy accounts require persisted verified-email status. Ambiguous, missing, invalid, unverified or changed recipients are skipped; jobs are never redirected to another account on a retry. Marketing consent and appointment-reminder opt-in are not reinterpreted as consent for these transactional decisions.

Templates contain only the committed pet name, service, Philippine date/time, decision status, and the already validated customer-facing decision reason (or the existing slot-closure reason). Internal notes, medical records, credentials, tokens and Google Form links are excluded. Missing details are labeled as not recorded; invalid legacy date/time strings are not normalized into invented details. HTML content is escaped and every email includes plain text and the official clinic website.

## Delivery and recovery

The worker runs in the **existing backend Node process**, alongside the existing reminder worker; no external queue, cron, service or new environment variable is required. After a successful commit, an asynchronous wake-up processes at most 10 jobs sequentially, pacing status sends at one per second per process. Database leases coordinate replicas. Rate-limit/provider failures retry with exponential backoff, up to eight attempts. Completed jobs remain permanently recorded to prevent automatic replay.

The worker checks for durable pending work at startup, wakes on committed staff decisions, and schedules timers only for backlog or retries. It does not poll an empty queue. On a sleeping/restarting host, pending jobs survive in PostgreSQL and resume when the backend runs again. **This does not guarantee a retry while a free hosting process is asleep.** An always-running external worker would be a separately approved infrastructure change if delivery latency during host sleep must be guaranteed.

Before contacting Resend, the exact recipient, sender, rendered content and event-based Message-ID are frozen in the ledger. The existing Resend transport uses that Message-ID as its idempotency key. Recovered attempts reuse the same payload. Automatic retries stop after 23 hours from the first attempt, before [Resend's 24-hour key expiry](https://resend.com/blog/engineering-idempotency-keys), and enter `needs_review` rather than risk a duplicate after an ambiguous acceptance. Permanent deduplication comes from the committed event and terminal ledger state, not solely the provider key.

States are `pending`, `accepted` (provider acceptance, not proof of inbox delivery), `skipped` (ineligible recipient), and `needs_review`. The ledger tracks appointment/event/customer IDs, type, attempt count, lease/retry times, provider ID, failure time and bounded failure code. Raw provider errors are not persisted. A failure never rolls back an already committed appointment decision. Terminal jobs must not be deleted or reset merely to retry them.

Immediate staff feedback reports that the appointment was updated and the email is pending. It never claims that a queued message was delivered. Delivery states are recorded privately; this change adds no delivery-status polling UI or duplicate toasts. A schedule refresh failure does not falsely report a committed decision as failed.

The isolated browser workflow passed approval, rejection, cancellation from pending and approved states, existing reason validation, and exactly one accurate pending-email toast for each decision. Cold Vite startup is given an explicit navigation/readiness allowance; business assertions are unchanged.

## Deployment and verification

Deploy the backend and frontend together using the existing build/deployment process. Existing `RESEND_API_KEY`, verified `RESEND_FROM_EMAIL`, mail delivery mode and Supabase admin configuration remain the prerequisites already used by the application. No additional SQL or infrastructure must be applied for the existing-process delivery mode. There is no bulk-email or historical-send command, promotional sending remains disabled, and no real customer email was sent during testing.

Validation includes 29 new mocked-provider/controller/PostgreSQL tests: approved/rejected/permitted cancellation transitions, unauthorized customers, rollback, duplicate and concurrent requests, slot closure, correct verified account resolution, frozen Resend wire payload/key, failure/retry, process-crash recovery, bounded batches, empty queues, Philippine formatting, safe reasons and invalid legacy dates. Six additional staff-feedback tests verify pending messages, single toasts, failed decisions and post-commit refresh failures. Existing signup, OTP, password reset and reminder transport tests also pass. The selected combined backend/mail/database run has 112 tests: 108 passed and four known baseline failures (two old reminder expectations and two outdated user-service test dependency mocks). An additional appointment UI/regression selection has 23 tests: 18 passed and five failures already present in the verified baseline. A staff-assignment regression now verifies both the appointment write and its new outbox write rather than incorrectly expecting just one total database write.

Production smoke checks, using an authorized test customer and new test appointments:

1. Approve Pending; verify one pending event, correct verified recipient and provider acceptance ID. Repeat the request; verify no second event.
2. Reject Pending and cancel Pending/Approved using existing reason controls; verify exact details and public reasons. Close a test slot to check the existing batch cancellation path.
3. Verify a Customer cannot approve/reject; customer cancellation does not trigger this staff-only feature. Confirm an unchanged/realtime refresh creates no email event.
4. Confirm a missing/unverified account is skipped and no request-supplied recipient is used.
5. In staging only, simulate provider failure and process restart; verify status remains committed, the same event/payload is retried, and no duplicate acceptance occurs. Never intentionally break production email settings for this test.
6. Inspect `pending`, `skipped` and `needs_review` jobs using an authorized read-only database session. Reconcile ambiguous jobs with Resend before any manual recovery; do not blindly reset them or generate a new key. Real inbox receipt and live deployment must be verified separately.
