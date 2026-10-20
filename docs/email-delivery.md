# Authentication email delivery

Verification codes, account activation links, password reset links, and appointment reminders use the backend's `MAIL_DELIVERY_MODE`.

Use `MAIL_DELIVERY_MODE=smtp` for app passwords, `gmail-api` for HTTPS OAuth delivery, or `auto` (the default) to prefer SMTP credentials and otherwise use Gmail API. Explicit `gmail-api` and disabled modes are respected, even if an app password is present. All email flows share the same transport, sender, and failure handling.

For Gmail SMTP, set `MAIL_DELIVERY_MODE=smtp`, `EMAIL_USER` (or `GMAIL_USER`), and `EMAIL_PASS` (a Gmail app password). The sender must match the account that owns the app password. `SMTP_USER` and `SMTP_PASS` override these values; `GMAIL_APP_PASSWORD` also takes precedence over `EMAIL_PASS`. Restart the backend after changing configuration.

Local configuration loads `.env` first, then `server/.env` with overrides. Hosted deployments need the same settings in the backend host's environment.

`535 Username and Password not accepted` means Gmail rejected the configured credentials. Replace the app password for the sender account. A successful connection check authenticates without sending email:

```powershell
node -e "require('./server/src/config/mailer').verifyMailerConnection().then(() => console.log('Connection verified')).catch(e => { console.error(e.message); process.exitCode = 1; })"
```

For Gmail API delivery, set `MAIL_DELIVERY_MODE=gmail-api`, `GMAIL_USER`, `GMAIL_CLIENT_ID`, `GMAIL_CLIENT_SECRET`, and `GMAIL_REFRESH_TOKEN` instead. SMTP configuration does not supply OAuth credentials.

Run the mocked authentication and reminder delivery regression tests with `node --test server/tests/mailer.test.js`.

SMTP port 465 uses `SMTP_SECURE=true`; port 587 uses `SMTP_SECURE=false` with STARTTLS. Gmail app-password spaces are removed; passwords for other SMTP hosts retain internal spaces. `SMTP_FROM_EMAIL` and `SMTP_FROM_NAME` override the sender settings. SMTP-only setups do not require Gmail OAuth credentials.

If SMTP verification times out, check outbound network access on the backend host. Hosts that block SMTP require HTTPS delivery: explicitly select `gmail-api` and configure valid OAuth credentials. Changing an app password cannot fix a blocked TCP connection.
