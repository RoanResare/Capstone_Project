# Low-Cost Kapon scheduling review

## Inspection and database cost

Inspected the checked-in Supabase migrations, collection mapping, browser access policy, promotion controller, realtime adapter, Resend transport, and appointment reminder worker. Production catalog/data were not queried or changed. Confirm deployed schema matches these migrations before rollout.

Existing `app_private.low_cost_kapon_promo` and `app_private.promotion_details` store JSONB documents. Reuse the fixed `low-cost-kapon` ID, `startsAt`, `endsAt`, `isActive`, and optimistic `revision`. Existing RLS, indexes, realtime trigger, and Admin/Staff endpoint authorization remain intact. No customer or promotion duplicates, backfills, or automatic edits to existing records are introduced.

**Supabase SQL required for the implemented scheduling changes: none.** No new tables, columns, indexes, triggers, or database jobs are needed. There is consequently no migration to execute.

## Application code

- Backend validates required timezone-aware timestamps, calendar validity, start >= server time + 24 hours, and end > start. Unchanged legacy schedules remain editable; changed schedules must satisfy the new rules.
- An authenticated, role-protected clock endpoint supplies modal defaults. Defaults round up to a 15-minute interval with a two-hour duration. Controls remain editable and invalid choices produce an inline error.
- Scheduling reuses `isActive: true` as enabled state. Effective Scheduled / Active / Expired status comes from timestamps, without writing status transitions. Booking remains protected by the existing server-side transactional availability check. This works after API cold starts and needs no continuously running worker.
- Customer read and query responses omit registration URLs before start, after expiration, and on deactivation. Active URLs remain available. Scheduled customer announcements have no registration action.
- Server timestamps plus elapsed monotonic browser time drive displayed boundaries. One boundary read retrieves the registration URL when a schedule starts. Realtime changes and focus/visibility recovery remain; recurring 30-second promotion polling is removed. The existing adapter still performs subscription reconciliation reads to close fetch/listen races.
- Existing Resend authentication, verification, password recovery, and appointment reminder behavior is untouched. Save responses explicitly report `disabled_pending_consent_approval`; no promotional mail is sent.

Native time inputs avoid the overflowing 96-option dropdown and request 15-minute steps. Their presentation follows device locale (including 12/24-hour preference); Philippine timezone is explicitly labeled. Browser checks use isolated data and intercept every API request.

## Promotional email design awaiting approval

No explicit promotional email consent or preference flow was found. Appointment `reminderEnabled` is transactional reminder consent and must not be treated as marketing consent. Sending is deliberately disabled, as requested, until this design is approved and implemented.

Proposed preference: add an opt-in boolean, consent timestamp, and consent-copy version to the existing customer profile JSONB. Default absent/false means opted out. Expose an authenticated preference endpoint and an unchecked customer-facing setting; allow only the account owner to change these fields. Include a signed, expiring unsubscribe link with one-click opt-out handling. Never subscribe existing customers automatically. This uses existing profiles, not duplicate customers.

Proposed delivery: use existing private `notifications` JSONB records for an immutable campaign keyed by promotion revision and per-recipient delivery records keyed by campaign plus customer ID. These are delivery records, not duplicate promotion/customer records. Commit campaign creation in the scheduling transaction. Snapshot campaign title, description, and schedule so later edits cannot alter an already queued announcement. Ordinary edits and realtime refreshes never create campaigns. Require explicit campaign approval and a recipient cap before enabling a production run.

Use the existing Resend transport and idempotency-key support. An external authenticated scheduler must invoke bounded delivery work; the existing appointment worker uses in-process timers and does not establish reliable operation while Render sleeps. Check current consent, active customer role, verified email, and email validity immediately before each attempt. Deduplicate normalized recipient addresses within the campaign. Send the requested subject/body, clinic identity, Philippine schedule, and preference/unsubscribe links; omit the Google Form URL while registration is closed.

Claim recipients with transactional leases, persist attempts/retry deadlines/provider IDs, and apply exponential backoff with bounded attempts. Start with batches of 10 and configurable provider pacing. Never log recipient addresses or tokens. A provider acceptance ID is not proof of inbox delivery. Do not retry an ambiguous accepted request beyond the provider's deduplication window without reconciliation; exactly-once physical delivery cannot be guaranteed by a database lease alone.

SQL remains **undetermined for email delivery** until scheduler/query design and deployed schema are confirmed. Existing notification indexes may suffice for bounded deterministic campaign processing; do not add speculative indexes. If a new index or job is unavoidable, supply a minimal idempotent SQL migration for review first. No email worker, consent fields, external cron, or email SQL has been enabled by this change.

Approval is needed for the consent wording/preference flow, campaign limits, external scheduler, unsubscribe handling, retention, and any subsequently demonstrated SQL requirement. This document is a design, not a claim that email sending/retries have been implemented or tested.

## Verification and rollout

Scheduling tests cover invalid/missing timestamps, exact 24-hour boundary, manipulated requests, Admin/Staff/Customer permissions, revisions, cross-month Philippine dates, and state boundaries. PostgreSQL API tests cover premature/expired link filtering on both read/query paths. Browser tests cover Admin/Staff scheduling, inline rejection, reload/deactivation, native controls, and desktop/mobile viewport sizes. Production frontend and backend builds are run locally.

The focused run passed 18/18 tests. The isolated browser check passed with production CSS and modal viewport-bound assertions. The broader appointment, scheduling, session-security, and appointment-reminder selection has 15 failures; the same 15 failures reproduce in an isolated checkout of the starting commit (54 tests, 39 passed). They include outdated authentication mocks, schedule-data fixtures, appointment category expectations, and reminder slot/eligibility expectations. Those unrelated modules and assertions were not changed or weakened. These results do not establish that all existing regressions pass and are a reason to retain feature-branch review before integration.

Do not deploy frontend before its corresponding backend clock/validation/response filtering changes. No production migration, rules deployment, bulk email, or production record mutation was performed. Keep this work on the feature branch while regression results and email prerequisites are reviewed; no main-branch deployment is claimed.
