# Resend email delivery

Registration activation links, admin/staff OTPs, password resets, and appointment reminders use the same Resend SDK client over HTTPS (port 443). Nodemailer and SMTP are no longer used.

Set these backend variables in Render, then redeploy:

```dotenv
MAIL_DELIVERY_MODE=resend
RESEND_API_KEY=your_resend_api_key
RESEND_FROM_EMAIL=notifications@your-verified-domain.com
EMAIL_FROM_NAME=Charming Fur-fection Pet Care
```

The sender reads process.env.RESEND_FROM_EMAIL and defaults to onboarding@resend.dev when unset or blank. EMAIL_FROM does not override this fallback. A custom sender must belong to a domain verified in your Resend account. The onboarding@resend.dev sender is limited to testing with the email address associated with your Resend account; it cannot deliver registration emails to arbitrary customers. See https://resend.com/docs/knowledge-base/403-error-resend-dev-domain.

The supplied key is stored only in ignored server/.env. Local configuration uses onboarding@resend.dev for testing as requested. Set RESEND_FROM_EMAIL to an address on your verified domain and restart to switch senders without editing code. The local file does not update Render environment variables. Never prefix RESEND_API_KEY with VITE_ or expose it to the browser.

A stale MAIL_DELIVERY_MODE=smtp still selects Resend when the Resend variables are configured. Explicit disabled/none/off/false modes disable delivery. Legacy EMAIL_USER, EMAIL_PASS, SMTP and OAuth variables cannot select another transport. Variables supplied by the launching process or deployment host take precedence over local env files.

Requests have a 30-second abort timeout. API rejection, sender restrictions, invalid keys, rate limits, and network failures fail delivery with a safe 503 response and provider diagnostics. A success requires Resend to return an email ID; API acceptance is not a guarantee of inbox placement. Reminder retries use a stable Idempotency-Key. Customer activation is required before sign-in.

Sending-only keys cannot list domains or API keys. Startup checks configuration only; each send validates API acceptance. No test messages are sent automatically.

Run focused checks:

```powershell
node --test server/tests/mailer.test.js server/tests/registrationProfile.test.js server/tests/appointmentReminder.test.js tests/firebaseRegistration.test.mjs
```

For a manual live test, set EMAIL_TEST_TO and run node server/scripts/testEmailDelivery.js. This sends four marked messages (OTP, activation, password reset, reminder) using nonfunctional example links. With onboarding@resend.dev, EMAIL_TEST_TO must be your Resend account address.
