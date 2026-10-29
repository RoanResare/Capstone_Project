# Firebase Auth to Supabase Auth cutover plan

## Current state

The browser and backend login paths now use Supabase Auth. The backend validates
passwords through Supabase Auth, checks the PostgreSQL profile and security
controls, and returns a Supabase session. Staff/admin sessions are created only
after the existing OTP ticket is verified. The browser stores and refreshes the
Supabase session, loads profiles from `/auth/me`, and uses the Supabase access
token for backend requests, including staff/admin routes. The Supabase `session_id` continues to key the existing
IP/session binding and session checks. PostgreSQL profile documents remain available through
`server/src/database/postgres.js` and `collections.js`.

The first compatibility slice remains enabled: backend middleware accepts both
verified Supabase and legacy Firebase tokens during rollout. New browser sessions
are Supabase-only. Profile UUIDs stay stable; `public.users.auth_user_id` records
the linked Supabase UUID and a unique index prevents identity reuse. Existing
profiles are linked on first successful password sign-in only after Supabase
reports the email as confirmed and the email resolves to one profile. New
registrations and employee accounts create Supabase Auth identities. Resend sends
custom activation and recovery links containing Supabase one-time token hashes.

The source build passes, but no hosted Supabase staging login, mail, OTP, or
revocation rehearsal has been performed. The dual verifier and database-token
exchange remain until those cutover gates pass.

## Migration stages

1. **Configure and verify Supabase Auth.** Set server-only `SUPABASE_URL` and
   `SUPABASE_ANON_KEY`, plus frontend `VITE_SUPABASE_URL` and
   `VITE_SUPABASE_ANON_KEY`. Do not expose service-role credentials. Confirm the
   URL is the Supabase project origin, not the Express `/api` origin. Enable
   email/password auth and configure redirect URLs in Supabase.
2. **Link identities to profiles.** Add a migration column such as
   `public.users.auth_user_id uuid UNIQUE REFERENCES auth.users(id)` while
   retaining `firebase_uid` as a legacy mapping. Link by verified email only
   after checking duplicates and account ownership; never overwrite an existing
   auth mapping automatically. Preserve the existing profile UUID/legacy key
   until related pets, appointments, ownership policies, sessions, and audit
   references have a tested mapping. The application adapter continues to read
   through the PostgreSQL compatibility view during this step.
3. **Move backend account lifecycle.** `auth.controller.js`,
   `registration.controller.js`, and the employee/profile operations in
   `user.service.js` now use Supabase Auth. Profile attributes and role
   authorization remain in PostgreSQL `public.users`. Recovery challenges use a
   signed, expiring envelope around Supabase's single-use token hash; activation
   challenges use Supabase token hashes directly. OTP, lockout, revocation, and
   account-status checks remain server-side. Apply migration
   `202610280003_supabase_auth_identity.sql` before enabling the new identity link.
4. **Move the frontend session.** `src/app/context/AuthContext.jsx`,
   `customerAccount.js`, `databaseToken.js`, `sessionSecurity.js`, `scheduleData.js`,
   `kaponPromo.js`, and `src/firebase.js` now use Supabase sessions/access tokens.
  Backend login is retained for rate-limit, fraud, session, and OTP enforcement;
  the returned session is installed with `supabase.auth.setSession`. Supabase
  token refresh events update the application's API token. Backend middleware
  validates the token and reloads authorization from PostgreSQL. Profile reads
   use the authorized `/auth/me` endpoint. Legacy Firebase Auth browser modules
   are no longer imported by the application.
5. **Cut token verification over.** After all clients use Supabase tokens, remove
   Firebase fallback from `middlewares/authenticate.js` and
   `routes/database.routes.js`; remove `/database/token` exchange if Supabase JWTs
   are used directly for Realtime. Recheck RLS claims and revoked-session logic.
6. **Retire Firebase.** Remove Firebase Auth/Admin dependencies and runtime
   configuration only after migration reconciliation and rollback window close.
   Keep Firebase export tooling and backup artifacts outside the runtime path
   until a separately approved retention decision.

## Files in the first implementation slice

- `server/src/config/env.js`: Supabase Auth project URL and public API key.
- `server/src/services/supabaseAuth.service.js`: issuer dispatch and remote token
  verification through Supabase Auth.
- `server/src/middlewares/authenticate.js`: accepts verified Supabase identities
  and applies existing PostgreSQL authorization checks.
- `server/src/routes/database.routes.js`: supports Supabase token exchange and
  request identity while retaining the Firebase overlap path.
- `supabase/migrations/202610280001_business_data.sql`: carries the authentication
  issue-time claim name while continuing to read legacy Firebase tokens.

## Cutover gates

Do not remove the Firebase verifier or custom-token path until all of these pass
in an isolated staging project: identity-link counts reconcile; customer and
staff sign-in work; OTP and recovery links work; profile updates and role changes
take effect; session revocation blocks API and Realtime access; old Firebase
sessions are rejected only after the planned expiry window; and browser refresh,
logout, account switching, and network recovery work. Keep both providers
available during staging only, and switch backend/frontend together.
