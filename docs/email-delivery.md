# Authentication email delivery

Verification codes, account activation links, and password reset links use the backend's `MAIL_DELIVERY_MODE`.

Providing `EMAIL_PASS`, `GMAIL_APP_PASSWORD`, or `SMTP_PASS` automatically selects Nodemailer SMTP, including when an older configuration sets `MAIL_DELIVERY_MODE=gmail-api`. An explicitly disabled delivery mode remains disabled. OAuth is used only when no app password is supplied.

For Gmail SMTP, set `MAIL_DELIVERY_MODE=smtp`, `EMAIL_USER` (or `GMAIL_USER`), and `EMAIL_PASS` (a Gmail app password). The sender must match the account that owns the app password. `SMTP_USER` and `SMTP_PASS` override these values; `GMAIL_APP_PASSWORD` also takes precedence over `EMAIL_PASS`. Restart the backend after changing configuration.

Local configuration loads `.env` first, then `server/.env` with overrides. Hosted deployments need the same settings in the backend host's environment.

`535 Username and Password not accepted` means Gmail rejected the configured credentials. Replace the app password for the sender account. A successful connection check authenticates without sending email:

```powershell
node -e "require('./server/src/config/mailer').verifyMailerConnection().then(() => console.log('Connection verified')).catch(e => { console.error(e.message); process.exitCode = 1; })"
```

For Gmail API delivery, set `MAIL_DELIVERY_MODE=gmail-api`, `GMAIL_USER`, `GMAIL_CLIENT_ID`, `GMAIL_CLIENT_SECRET`, and `GMAIL_REFRESH_TOKEN` instead. SMTP configuration does not supply OAuth credentials.

Run the mocked OTP delivery regression test with `node --test server/tests/mailer.test.js`.
