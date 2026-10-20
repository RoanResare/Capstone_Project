# Appointment reminder emails

The backend checks at startup and each wall-clock minute. Only bookings with `reminderEnabled: true` and an Approved, Accepted, or Confirmed status receive an email reminder one hour before their saved slot, in Asia/Manila. Pending bookings do not receive reminders:

| Appointment | Reminder |
| --- | --- |
| 09:00 AM | 08:00 AM |
| 11:00 AM | 10:00 AM |
| 02:00 PM | 01:00 PM |
| 04:00 PM | 03:00 PM |

Keep the backend running on an always-on host. Sleeping hosts cannot run the worker on time. A restart catches up due reminders before the appointment begins; nothing sends after the appointment starts. Inbox arrival at an exact second cannot be guaranteed by an email provider.

Reminders share the authentication email transport and use the Resend HTTPS API configured with `RESEND_API_KEY` and `RESEND_FROM_EMAIL`. See [email delivery configuration](email-delivery.md). They honor disabled delivery mode and retain a stable message ID across retries.

Delivery claims and successful sends are stored in the server-only `appointmentReminders` collection, keyed by appointment ID and schedule. Failed deliveries retry after a minute. Claims expire after five minutes if a process crashes. Resend receives a stable idempotency key for each reminder delivery so retries within its idempotency retention window do not send duplicates. Rescheduled bookings have a separate delivery key. No appointment status, no-show status, penalty, or customer restriction is changed by reminders. The previous automatic no-show worker is no longer started.

Run scheduling and retry checks with `node --test server/tests/appointmentReminder.test.js`.
