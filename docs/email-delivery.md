# SMTP email delivery

OTPs, activation links, password resets, and appointment reminders all use one shared Nodemailer SMTP transport. Set these values in the backend environment:

```dotenv
MAIL_DELIVERY_MODE=smtp
EMAIL_USER=your-mailbox@gmail.com
EMAIL_PASS=your_gmail_app_password
SMTP_HOST=smtp.gmail.com
SMTP_PORT=465
SMTP_SECURE=true
```

The credentials come exclusively from EMAIL_USER and EMAIL_PASS. Gmail app-password spaces are removed. Legacy Gmail API, OAuth, SMTP_USER, SMTP_PASS, and GMAIL_APP_PASSWORD settings are ignored. Even a stale MAIL_DELIVERY_MODE=gmail-api uses SMTP; explicit disabled/none/off/false modes still disable delivery. Missing credentials never fall back to another provider.

The sender defaults to EMAIL_USER. EMAIL_FROM and EMAIL_FROM_NAME configure the sender; SMTP_FROM_EMAIL and SMTP_FROM_NAME override those sender settings. Use the account that owns the app password or an authorized sender alias.

Local configuration loads .env first, then server/.env with overrides. Variables supplied by the launching process or deployment host take precedence over both files, so a stale file cannot replace an updated hosted app password. Restart the backend after changes. Hosted backends need these same variables configured on the host and the latest server code redeployed; changing local files does not update a hosted API.

Gmail (`smtp.gmail.com`) explicitly uses port 465 with `secure: true`, regardless of stale SMTP_PORT or SMTP_SECURE values. Custom SMTP hosts still support port 587 with SMTP_SECURE=false and STARTTLS. The transport uses the operating system DNS resolver, automatic IPv4/IPv6 selection, TLS 1.2 or newer, and certificate verification. TLS on port 465 completes before the SMTP greeting; the socket is marked secured so Nodemailer does not perform TLS twice. Connection and greeting timeouts are 30 seconds; socket inactivity times out after 60 seconds.

Render Free web services block outbound ports 25, 465, and 587: https://render.com/docs/free. Changing ports, TLS, credentials, or timeouts cannot bypass that restriction. To keep Gmail SMTP, use a Render instance that permits outbound SMTP. An HTTPS email API is an alternative requiring a separate provider integration; this application continues to use its unified SMTP transport.

A 535 authentication error means the server rejected the username/app password. Connection timeouts require checking DNS, firewall rules, host, port, and TLS settings.

Verify authentication without sending mail:

```powershell
node -e "require('./server/src/config/mailer').verifyMailerConnection().then(() => console.log('SMTP verified')).catch(e => { console.error(e.message); process.exitCode = 1; })"
```

Run regression checks with `node --test server/tests/mailer.test.js server/tests/appointmentReminder.test.js`. To send four clearly marked live messages to the sender's inbox, run `node server/scripts/testEmailDelivery.js`. Test links are deliberately nonfunctional and do not change accounts.
