# Resend email delivery

Registration activation links, admin/staff OTPs, password resets, and appointment reminders use the same Resend SDK client over HTTPS (port 443). Nodemailer and SMTP are no longer used.

Set these backend variables in Render, then redeploy:

```dotenv
MAIL_DELIVERY_MODE=resend
RESEND_API_KEY=your_resend_api_key
RESEND_FROM_EMAIL=noreply@charmingfurfectionpetscareservices.online
EMAIL_FROM=support@charmingfurfectionpetscareservices.online
EMAIL_FROM_NAME=Charming Fur-fection Pet Care
```

The sender reads process.env.RESEND_FROM_EMAIL and defaults to noreply@charmingfurfectionpetscareservices.online when unset or blank. EMAIL_FROM does not override this fallback. All four email flows share this sender. The transport rejects resend.dev test senders and malformed addresses before sending. Any overridden sender must belong to a domain verified in the Resend account associated with the API key.

Local configuration uses the custom-domain sender. The local file does not update Render environment variables: replace any existing test sender in Render with the values above and restart/redeploy. Use a Resend API key with sending permission for the verified domain. Never prefix RESEND_API_KEY with VITE_ or expose it to the browser.

A stale MAIL_DELIVERY_MODE=smtp still selects Resend when the Resend variables are configured. Explicit disabled/none/off/false modes disable delivery. Legacy EMAIL_USER, EMAIL_PASS, SMTP and OAuth variables cannot select another transport. Variables supplied by the launching process or deployment host take precedence over local env files.

Requests have a 30-second abort timeout. API rejection, sender restrictions, invalid keys, rate limits, and network failures fail delivery with a safe 503 response and provider diagnostics. A success requires Resend to return an email ID; API acceptance is not a guarantee of inbox placement. Reminder retries use a stable Idempotency-Key. Customer activation is required before sign-in.

Sending-only keys cannot list domains or API keys. Startup checks configuration only; each send validates API acceptance. No test messages are sent automatically.

Run focused checks:

```powershell
node --test server/tests/mailer.test.js server/tests/registrationProfile.test.js server/tests/appointmentReminder.test.js tests/firebaseRegistration.test.mjs
```

For a manual live test, set EMAIL_TEST_TO and run node server/scripts/testEmailDelivery.js. This sends four marked messages (OTP, activation, password reset, reminder) using nonfunctional example links.

Reminders run in the backend process every minute for opted-in appointments with approved/accepted/confirmed status, starting one hour before the appointment (Asia/Manila). Keep the backend running continuously for timely reminders; a sleeping instance cannot run its timer. Failed sends retry with a stable idempotency key.
