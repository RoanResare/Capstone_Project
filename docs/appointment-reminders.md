# Appointment reminder emails

The backend checks at startup and each wall-clock minute. Bookings with `reminderEnabled: true` and a Pending, Approved, Accepted, or Confirmed status receive a Gmail SMTP reminder one hour before their saved slot, in Asia/Manila:

| Appointment | Reminder |
| --- | --- |
| 09:00 AM | 08:00 AM |
| 11:00 AM | 10:00 AM |
| 02:00 PM | 01:00 PM |
| 04:00 PM | 03:00 PM |

Keep the backend running on an always-on host. Sleeping hosts cannot run the worker on time. A restart catches up due reminders before the appointment begins; nothing sends after the appointment starts. Inbox arrival at an exact second cannot be guaranteed by SMTP.

Reminders use `GMAIL_USER` and optionally `GMAIL_APP_PASSWORD` (a Google app password, not the account password). Without an app password, SMTP uses the existing `GMAIL_CLIENT_ID`, `GMAIL_CLIENT_SECRET`, and `GMAIL_REFRESH_TOKEN`; SMTP OAuth requires consent for `https://mail.google.com/`, so a token limited to Gmail API send permission must be reauthorized. Existing authentication emails continue using the Gmail API and its existing configuration. See [Nodemailer's Gmail setup](https://nodemailer.com/usage/using-gmail/).

Delivery claims and successful sends are stored in the server-only `appointmentReminders` collection, keyed by appointment ID and schedule. Failed deliveries retry after a minute. Claims expire after five minutes if a process crashes. As with SMTP generally, a crash after Gmail accepts a message but before Firestore records success can result in a duplicate retry. Rescheduled bookings have a separate delivery key. No appointment status, no-show status, penalty, or customer restriction is changed by reminders. The previous automatic no-show worker is no longer started.

Run scheduling and retry checks with `node --test server/tests/appointmentReminder.test.js`.
