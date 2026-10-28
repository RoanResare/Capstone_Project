# Provision legacy admin and staff accounts in Supabase Auth

The backend authenticates admin/staff passwords against Supabase Auth, then
loads the account role, status, and fraud status from the existing PostgreSQL
`public.users` profile. Firebase passwords are not copied by the profile or
identity migrations. The provisioning script creates only missing Supabase Auth
identities and links them to existing profiles without changing profile IDs or
roles.

## Before running

1. Apply migrations `202610280001`, `202610280002`, and
   `202610280003_supabase_auth_identity.sql` to the intended Supabase project.
2. Configure `DATABASE_URL`, `SUPABASE_URL`, and the server-only
   `SUPABASE_SERVICE_ROLE_KEY` in the local server environment. Never put the
   service-role key in a `VITE_` variable or browser code.
3. Verify that each target is an active `admin` or `staff` row in
   `public.users`, that its email belongs to the intended employee, and that no
   duplicate profile uses the same email.
4. Run the script first without `--execute` to review the dry-run output.

## Provision selected accounts

From the `server` directory, pass only the email addresses you reviewed:

```sh
npm run auth:provision-staff -- --emails=admin@example.com,staff@example.com --execute --confirm-email-ownership
```

`--execute` requires both an explicit email allowlist and
`--confirm-email-ownership`. The script creates missing Auth accounts with a
random temporary password held only in memory, confirms the email because the
operator has attested to ownership, and links the new Auth UUID to the existing
profile. It does not display or save that password. Existing unconfirmed Auth
accounts are not linked unless the same confirmation flag is supplied. A
profile already linked to a different Auth UUID, duplicate profile emails, or
role/status changes cause the script to stop or skip that profile.

The PostgreSQL profile role remains authoritative for authorization. Auth
`user_metadata.role` is synchronized for account information only.

## Set employee passwords

After provisioning, each employee should open the app's **Forgot Password**
page, request a reset for their registered email, and choose a private password
from the emailed link. The reset route checks the existing PostgreSQL profile
and Supabase Auth identity, then updates the Supabase password. Admin/staff
sign-in will continue to require the configured emailed OTP after password
verification. Ensure the backend has its Resend sender and OTP settings before
starting this recovery step.

Do not insert rows into `auth.users` with SQL. Use the server-side Supabase Auth
Admin API; Supabase specifically requires that the service-role key remain
server-side ([Admin `createUser` reference](https://supabase.com/docs/reference/javascript/auth-admin-createuser)).
