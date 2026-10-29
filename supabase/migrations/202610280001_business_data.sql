BEGIN;
CREATE SCHEMA IF NOT EXISTS app_private;
REVOKE ALL ON SCHEMA app_private FROM PUBLIC, anon, authenticated;

-- Separate collection tables retain heterogeneous legacy fields losslessly.
DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'users','usernames','appointments','pets','deleted_pets','availability_slots',
    'notifications','photo_moderation','low_cost_kapon_promo','promotion_details',
    'service_pricelists','session_security','session_connections',
    'authentication_attempts','phone_account_limits','admin_staff_otp','appointment_reminders','customers',
    'chatbot_faqs','services','time_slots','slot_management_camel','schedules',
    'slot_management','revoked_tokens'
  ] LOOP
    EXECUTE format('CREATE TABLE IF NOT EXISTS app_private.%I (
      id text COLLATE "C" PRIMARY KEY CHECK (id <> '''' AND position(''/'' in id) = 0),
      data jsonb NOT NULL CHECK (jsonb_typeof(data) = ''object''),
      updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
    )', table_name);
    EXECUTE format('ALTER TABLE app_private.%I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('REVOKE ALL ON app_private.%I FROM PUBLIC, anon, authenticated', table_name);
    EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON app_private.%I USING gin (data jsonb_path_ops)', table_name || '_data_gin', table_name);
  END LOOP;
END $$;

CREATE TABLE IF NOT EXISTS app_private.firestore_archive (
  path text PRIMARY KEY, data jsonb NOT NULL,
  imported_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE app_private.firestore_archive ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON app_private.firestore_archive FROM PUBLIC, anon, authenticated;

-- These expressions match the adapter's parameterized query compiler.
DO $$
DECLARE spec text[]; col text; field text;
BEGIN
  FOREACH spec SLICE 1 IN ARRAY ARRAY[
    ['users','uid'],['users','email'],['users','phone'],['users','username'],['users','role'],
    ['users','verificationExpiresAt'],['usernames','uid'],['pets','customerId'],
    ['pets','ownerId'],['pets','customerEmail'],['appointments','customerId'],
    ['appointments','ownerId'],['appointments','customerEmail'],['appointments','petRecordId'],
    ['appointments','slotId'],['appointments','status'],['appointments','scheduleDate'],
    ['appointments','assignedStaff'],['notifications','targetUserId'],['notifications','createdAt'],
    ['admin_staff_otp','userId'],['admin_staff_otp','isUsed'],['admin_staff_otp','createdAt'],
    ['appointment_reminders','leaseUntil'],['appointment_reminders','retryAt'],['appointment_reminders','sentAt']
  ] LOOP
    col := spec[1]; field := spec[2];
    EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON app_private.%I ((data #> %L), id)', col || '_' || lower(field) || '_idx', col, '{' || field || '}');
  END LOOP;
END $$;
CREATE INDEX IF NOT EXISTS appointments_staff_day_status_idx ON app_private.appointments
  ((data #> '{assignedStaff}'), (data #> '{scheduleDate}'), (data #> '{status}'));
CREATE INDEX IF NOT EXISTS appointments_slot_status_idx ON app_private.appointments
  ((data #> '{slotId}'), (data #> '{status}'));
CREATE INDEX IF NOT EXISTS users_verification_seconds_idx ON app_private.users
  (((data #>> '{verificationExpiresAt,seconds}')::numeric * 1000000000 +
    (data #>> '{verificationExpiresAt,nanoseconds}')::numeric));

-- No user/business payload is exposed through logical replication. Insert-only
-- events avoid DELETE-event RLS limitations and cover ownership changes/deletes.
CREATE TABLE IF NOT EXISTS public.database_changes (
  event_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  collection_name text NOT NULL,
  document_id text NOT NULL,
  audience_uid text,
  operation text NOT NULL CHECK (operation IN ('INSERT','UPDATE','DELETE')),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS database_changes_retention_idx ON public.database_changes(created_at);
ALTER TABLE public.database_changes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.database_changes FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.database_changes TO authenticated;

CREATE OR REPLACE FUNCTION app_private.can_receive_change(collection_name text, audience_uid text)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE claims jsonb := auth.jwt(); profile jsonb; cutoff bigint;
BEGIN
  IF claims->>'iss' IS DISTINCT FROM 'furfection-database' OR claims->>'sub' IS NULL THEN RETURN false; END IF;
  SELECT u.data INTO profile FROM app_private.users u
    WHERE u.id = claims->>'sub' OR u.data->>'uid' = claims->>'sub'
    ORDER BY (u.id = claims->>'sub') DESC LIMIT 1;
  IF profile IS NULL OR lower(btrim(coalesce(nullif(btrim(profile->>'accountStatus'), ''), profile->>'status', 'active'))) IN ('inactive','archived','suspended')
    OR lower(btrim(coalesce(profile->>'fraudStatus', 'normal'))) IN ('suspended','banned') THEN RETURN false; END IF;
  SELECT coalesce((s.data->>'revokedBefore')::bigint, 0) INTO cutoff
    FROM app_private.session_security s WHERE s.id = claims->>'sub';
  IF coalesce(cutoff, 0) > 0 AND coalesce((claims->>'auth_iat')::bigint, (claims->>'firebase_iat')::bigint, 0) <= cutoff THEN RETURN false; END IF;
  IF collection_name IN ('availabilitySlots','lowCostKaponPromo','services','chatbot_faqs') THEN RETURN true; END IF;
  IF collection_name IN ('appointments','pets','notifications','photoModeration','servicePricelists')
    AND lower(btrim(profile->>'role')) IN ('admin','staff') THEN RETURN true; END IF;
  RETURN audience_uid = claims->>'sub' AND collection_name IN ('users','appointments','pets','notifications');
END $$;
REVOKE ALL ON FUNCTION app_private.can_receive_change(text,text) FROM PUBLIC, anon;
GRANT USAGE ON SCHEMA app_private TO authenticated;
GRANT EXECUTE ON FUNCTION app_private.can_receive_change(text,text) TO authenticated;
DROP POLICY IF EXISTS database_changes_read ON public.database_changes;
CREATE POLICY database_changes_read ON public.database_changes FOR SELECT TO authenticated
  USING (app_private.can_receive_change(collection_name, audience_uid));

CREATE OR REPLACE FUNCTION app_private.emit_database_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE payload jsonb; owner_uid text; previous_uid text; record_id text;
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.data IS NOT DISTINCT FROM NEW.data THEN RETURN NEW; END IF;
  payload := CASE WHEN TG_OP = 'DELETE' THEN OLD.data ELSE NEW.data END;
  record_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.id ELSE NEW.id END;
  owner_uid := coalesce(nullif(payload->>'customerId',''), nullif(payload->>'ownerId',''), nullif(payload->>'targetUserId',''));
  IF TG_ARGV[0] = 'notifications' THEN owner_uid := nullif(payload->>'targetUserId',''); END IF;
  IF TG_ARGV[0] = 'users' THEN owner_uid := coalesce(payload->>'uid', record_id); END IF;
  IF TG_ARGV[0] IN ('appointments','pets') AND owner_uid IS NULL AND nullif(payload->>'customerEmail','') IS NOT NULL THEN
    SELECT coalesce(u.data->>'uid', u.id) INTO owner_uid FROM app_private.users u
      WHERE lower(u.data->>'email') = lower(payload->>'customerEmail') LIMIT 1;
  END IF;
  INSERT INTO public.database_changes(collection_name,document_id,audience_uid,operation)
    VALUES (TG_ARGV[0],record_id,owner_uid,TG_OP);
  IF TG_OP = 'UPDATE' THEN
    previous_uid := coalesce(nullif(OLD.data->>'customerId',''), nullif(OLD.data->>'ownerId',''), nullif(OLD.data->>'targetUserId',''));
    IF TG_ARGV[0] = 'notifications' THEN previous_uid := nullif(OLD.data->>'targetUserId',''); END IF;
    IF TG_ARGV[0] IN ('appointments','pets') AND previous_uid IS NULL AND nullif(OLD.data->>'customerEmail','') IS NOT NULL THEN
      SELECT coalesce(u.data->>'uid', u.id) INTO previous_uid FROM app_private.users u
        WHERE lower(u.data->>'email') = lower(OLD.data->>'customerEmail') LIMIT 1;
    END IF;
    IF previous_uid IS NOT NULL AND previous_uid IS DISTINCT FROM owner_uid THEN
      INSERT INTO public.database_changes(collection_name,document_id,audience_uid,operation)
        VALUES (TG_ARGV[0],record_id,previous_uid,TG_OP);
    END IF;
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END $$;
REVOKE ALL ON FUNCTION app_private.emit_database_change() FROM PUBLIC, anon, authenticated;
DO $$
DECLARE item text[];
BEGIN
  FOREACH item SLICE 1 IN ARRAY ARRAY[
    ['users','users'],['appointments','appointments'],['pets','pets'],
    ['availability_slots','availabilitySlots'],['notifications','notifications'],
    ['photo_moderation','photoModeration'],['low_cost_kapon_promo','lowCostKaponPromo'],
    ['service_pricelists','servicePricelists'],['services','services'],['chatbot_faqs','chatbot_faqs']
  ] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS emit_change ON app_private.%I', item[1]);
    EXECUTE format('CREATE TRIGGER emit_change AFTER INSERT OR UPDATE OR DELETE ON app_private.%I FOR EACH ROW EXECUTE FUNCTION app_private.emit_database_change(%L)', item[1], item[2]);
  END LOOP;
END $$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') AND NOT EXISTS (
    SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'database_changes'
  ) THEN ALTER PUBLICATION supabase_realtime ADD TABLE public.database_changes; END IF;
END $$;
COMMIT;
