# Staging setup and migration rehearsal

The implementation is opt-in and has not been connected to a hosted Supabase
project. Do not turn it on in production. Keep Firebase Authentication, Firebase
Storage and current Firestore records intact.

## Private staging configuration

1. Create a separate Supabase staging project. Use Supabase **Connect** to copy
   its PostgreSQL **session pooler** connection string. Store it as `DATABASE_URL`
   in ignored `server/.env` or private deployment settings. Preserve certificate
   verification; use the TLS configuration supplied by Supabase. Do not use a
   database connection URL or privileged key in any `VITE_` variable.
2. Copy the staging project's real API URL and publishable key into the ignored
   root `.env` as `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`. The earlier
   `https://api.charmingfurfectionpetscareservices.online/api` value is the Express
   API origin; use it only if an operator has separately configured it to proxy
   all Supabase REST and websocket routes. This branch does not create that proxy.
3. Configure `SUPABASE_JWT_SECRET` on the server with the **staging project's
   legacy HS256 JWT signing secret**. It is not the publishable key, the
   `sb_secret_` API key or the app's existing `JWT_SECRET`. Confirm that legacy
   verification is enabled for this staging project. If the project only accepts
   asymmetric signing keys, adapt and test the signing/verification configuration
   before proceeding; do not disable RLS or expose a service-role key as a fix.
4. Retain all Firebase Auth, web API, mail, OTP, password-pepper, network-security
   and Storage settings. Use a nonproduction Firebase Auth project/test identities
   for rehearsal, or independently approved isolated test accounts. Do not replay
   customer emails or send real reminders from a staging copy.
5. Use [staging.env.example](staging.env.example) for names. `server/.env` overrides
   root `.env`; inherited host settings override both. Vite `.env.production`
   overrides root public values during a production build. Check the effective
   settings privately without printing secrets.
6. Keep provider switches at `firestore` while preparing the staging database.
   Set `MIGRATION_TARGET=staging` for the migration CLI. Runtime adapters do not
   apply schema or migrate data on startup.

## Schema, backup, import and verification

Install dependencies using the lockfiles in both the root and server directories.
The SQL below changes only the separately configured staging target. From the
project root:

```powershell
node server/scripts/postgresMigration.js schema
```

Alternatively execute both SQL files in order: `202610280001_business_data.sql`,
then `202610280002_public_relational_tables.sql`, using the staging Supabase SQL
editor. Together they create the document/archive compatibility layer and adapt
the supplied public `users`, `pets`, `services`, `appointments`, `products` and
`orders` UUID tables with relationship indexes and compatibility views. Check
that `public.database_changes` is in the `supabase_realtime` publication. Never
publish the private document tables or grant them to browser roles.

Take an independent Firestore managed backup / point-in-time backup first. Use
an access-controlled, preferably encrypted directory **outside the repository**.
On Windows, mode 0600 does not configure NTFS ACLs: restrict the directory to the
operator before exporting. The NDJSON backup contains customer and security
records, including hashed OTPs and credential metadata. Do not upload it to Git,
chat, public issue trackers or ordinary build artifacts.

The following is for a rehearsal source. **A final production export/transfer
requires explicit user approval and a write freeze.**

```powershell
node server/scripts/postgresMigration.js export C:\PrivateBackups\rehearsal.firestore-backup.ndjson
node server/scripts/postgresMigration.js import C:\PrivateBackups\rehearsal.firestore-backup.ndjson
node server/scripts/postgresMigration.js validate C:\PrivateBackups\rehearsal.firestore-backup.ndjson
```

Export traverses all collections and subcollections, including descendants of
missing parent documents. It does not modify Firestore. A manifest records counts
and an SHA-256 checksum. Export is sequential, **not a database-wide snapshot**;
a write freeze or consistent managed source is mandatory for final cutover.
Existing output files are never overwritten. An interrupted export without its
completed manifest cannot be imported.

Import checks the manifest and duplicate paths before starting one atomic SQL
transaction. It upserts by original ID/path, so retries do not duplicate data.
Unknown collections and subcollections are retained in `firestore_archive` with
their full paths. They are not silently treated as supported application tables.
Import does not delete target records that are absent from a backup; validation
reports those as unexpected. Always rehearse against an empty staging target.

Validation compares every source document's canonical typed-data hash, reports
missing/different/unexpected counts, and audits owner/pet/slot/username links and
duplicate emails. It prints only aggregate counts. A nonzero relationship count
may reflect a legitimate legacy forecast slot or retained appointment history;
review privately rather than automatically deleting, relinking or fabricating
records. Do not approve cutover until each discrepancy is resolved or explicitly
accepted and documented.

## Enable and test staging only

1. Stop staging workers while importing. Disable real outbound mail/reminder
   delivery in the isolated test environment using existing mail configuration.
2. Set **both** `DATABASE_PROVIDER=postgres` on the staging server and
   `VITE_DATABASE_PROVIDER=postgres` for the staging frontend build. Restart the
   server and rebuild Vite. Provider mismatch headers reject mixed configurations
   for the normal Axios API paths. Never change just one side on a live system.
3. Verify Firebase Auth token checks and the `/api/database/token` exchange. Tokens
   expire after five minutes, carry `role=authenticated`, and preserve the source
   token issue time for revocation checks. Business data remains behind Node.
4. Test admin, staff and two customers in separate browsers: registration,
   activation, OTP, login/logout, profile/password updates, suspension, roles,
   account deletion, revocation, pets, booking and approval, cancellation, slot
   closure, promo edits, pricelists, notifications and the Groq chatbot.
5. Run overlapping bookings from separate processes/connections and preferably
   two server instances. Confirm one accepted reservation when capacity is one.
   Local PGlite tests use a single serialized database session; they do not prove
   multi-instance lock behavior or hosted latency.
6. Verify browser tab hide/show, focus, offline/reconnect, rapid edits/deletes,
   ownership transfers and listener cleanup. Check that no business Firestore
   network requests occur in PostgreSQL mode; Firebase Auth/Storage traffic is
   expected. Supabase events carry IDs, not document payloads.
7. Measure actual initial load, action latency, websocket delivery, SQL query
   count, CPU/memory, connection count, table/index size and lock waits with the
   same synthetic load as Firestore. No hosted performance equivalence has been
   demonstrated yet. The conservative global write lock prioritizes correctness
   and can limit throughput; benchmark it before cutover.
8. Maintain event retention through a scheduled **server/admin-only** daily SQL
   task: `DELETE FROM public.database_changes WHERE created_at < now() - interval
   '1 day';`. Reconnect always refetches current data, so old event rows are not
   required for replay. Monitor event-table growth on the Free plan.

Modules for inventory, ordering, payments, POS and sales are absent from this
checkout. Supply their actual source/schema before including them in migration
sign-off. No substitute features were invented.

## Approved production window and rollback

The CLI deliberately only accepts imports/schema/validation labeled `staging`.
It is **not** authorization for production transfer. After the user approves a
specific production window, prepare a separately reviewed production target
procedure and staging-tested schema/backup/import commands. Do not relabel a
production database as staging to bypass this gate.

In that approved window: freeze all frontend/API/worker writes, take independent
backups, export from the frozen source, verify manifests, import into an empty
PostgreSQL target, compare all hashes/counts/relationships, validate Firebase Auth
and Realtime permissions, then switch server/frontend/workers together. Use a
staged release and smoke tests before reopening writes. Keep Firestore read-only
and preserve rollback backups.

Before PostgreSQL accepts new writes, rollback can restore the original provider
configuration and frontend build because Firestore has not changed. **After new
PostgreSQL writes, switching back alone loses those changes.** Freeze writes
again, preserve PostgreSQL (`pg_dump` using a private credential file/host secret,
never a password on the command line), and run a separately approved, validated
reverse reconciliation before reopening Firestore. No automatic reverse importer
or destructive cleanup is included. Do not delete either database during rollback.

## References

- [Supabase Postgres Changes](https://supabase.com/docs/guides/realtime/postgres-changes)
- [Supabase row-level security](https://supabase.com/docs/guides/database/postgres/row-level-security)
- [Supabase third-party Firebase Auth](https://supabase.com/docs/guides/auth/third-party/firebase-auth)
- [Supabase JWT signing keys](https://supabase.com/docs/guides/auth/signing-keys)

The existing Firebase app `role` claims distinguish admin/staff/customer. This
implementation uses a short-lived backend token exchange rather than replacing
those claims with a PostgreSQL role. Hosted JWT acceptance must be verified in
the actual staging project.
