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

Local configuration loads .env first, then server/.env with overrides. Restart the backend after changes. Hosted backends need these same variables configured on the host and the latest server code redeployed; changing local files does not update a hosted API.

Port 465 uses SMTP_SECURE=true. Port 587 uses SMTP_SECURE=false with STARTTLS. The transport uses the operating system DNS resolver and keeps TLS certificate verification enabled. Outbound SMTP access is required on the backend host.

A 535 authentication error means the server rejected the username/app password. Connection timeouts require checking DNS, firewall rules, host, port, and TLS settings.

Verify authentication without sending mail:

```powershell
node -e "require('./server/src/config/mailer').verifyMailerConnection().then(() => console.log('SMTP verified')).catch(e => { console.error(e.message); process.exitCode = 1; })"
```

Run regression checks with `node --test server/tests/mailer.test.js server/tests/appointmentReminder.test.js`. To send four clearly marked live messages to the sender's inbox, run `node server/scripts/testEmailDelivery.js`. Test links are deliberately nonfunctional and do not change accounts.
