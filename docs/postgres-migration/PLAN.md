# Firestore to Supabase PostgreSQL preparation

This branch is staging preparation. Firestore remains the default. Production
export/import, deployment and provider cutover require separate approval.

## Verified source inventory and design

Backend database access enters through `server/src/config/firebaseAdmin.js`.
Firebase Admin Auth must stay independent of the business database provider.
The existing controllers enforce booking capacity, staff conflicts, pet ownership,
promo revision checks, account restrictions and OTP locks inside transactions.
Preserving those controllers while replacing their storage implementation limits
business-rule drift. The PostgreSQL adapter will implement only verified query,
snapshot, batch and transaction operations, rejecting unsupported operations.

Known collections: users, usernames, appointments, pets, deletedPets,
availabilitySlots, notifications, photoModeration, lowCostKaponPromo,
promotionDetails, servicePricelists, sessionSecurity, sessionConnections,
authenticationAttempts, phoneAccountLimits, admin_staff_otp. Firestore rules also
name customers, chatbot_faqs, services, timeSlots, slotManagement, schedules,
slot_management and revoked_tokens. These will have separate PostgreSQL tables.
No runtime subcollection access was found. Export must still recursively discover
all collections/subcollections, including unreferenced or orphaned descendants.
Unknown paths go to a lossless archive rather than being discarded.

Each collection gets an ID-keyed table with JSONB document payload. This preserves
optional fields, heterogeneous legacy records, arrays and nested objects without
inventing required foreign keys that could reject existing data. Relationship
audits identify missing owners, pets, slots and duplicate identities before
cutover. Expression indexes cover actual query fields. Foreign keys should only
be added after those audits pass and lifecycle retention requirements are agreed.
Firestore timestamps, references, bytes and geography need lossless type tags.

The Node API is the data authorization boundary. Private document tables have RLS
and no browser grants. The only browser-readable realtime table contains minimal
invalidation events. Its RLS must recheck current account status and revocation.
The backend exchanges an existing verified Firebase token for a short-lived
Supabase-compatible token; no change to Firebase app role claims is required.
Business payloads are fetched through authorized endpoints, not event payloads.

Frontend Firestore calls are in scheduleData, kaponPromo, customerAccount and
firebaseAuth. A provider facade retains the Firestore path by default and uses
authorized HTTP operations plus Supabase `postgres_changes` when opted into
PostgreSQL. Subscription bootstrap must subscribe before fetching, recover on
reconnect and clean up; changes should fetch affected documents where possible.
Firebase Authentication, Analytics and Storage stay in place.

No implemented product inventory, order, payment, POS or sales database flows were
found in this checkout. Do not invent tables/workflows or claim tests for them.
The Groq chat path does not read Firestore. Existing broken tests are recorded in
the previous read-audit report and must be distinguished from migration failures.

## Implementation and gates

1. Add private collection schema, query indexes and least-privilege realtime SQL.
2. Implement typed values, pooled PostgreSQL reads, atomic batches and serialized
   critical transactions; run real PostgreSQL-engine tests locally.
3. Add read-only recursive export, idempotent staging import, integrity validation
   and aggregate-only reports. Keep backups/customer data outside the repository.
4. Wire the backend provider and frontend facade; retain Firebase token checks.
5. Test SQL authorization, concurrency, response compatibility, replay/reconnect,
   cleanup, and all available feature suites. Document live-test limitations.
6. Apply schema to a separate Supabase staging project and rehearse migration.
   Verify counts and hashes, ownership, rollback, latency and multi-user behavior.
7. Obtain explicit production approval. Freeze writes, take/export immutable
   backups, import and validate final state, then change both providers together.
   Never dual-write independently to both databases or flip only one provider.

The previously supplied URL is the existing Express `/api` origin. A Supabase
project URL (or confirmed proxy serving Supabase REST/auth/realtime routes), a
server PostgreSQL connection URL and a server Supabase JWT signing secret still
need staging configuration. A publishable/secret API key is not a SQL password
or JWT signing secret. Do not send credentials in chat or add them to Git.
