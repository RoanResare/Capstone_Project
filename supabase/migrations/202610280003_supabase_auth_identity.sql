-- Link Supabase Auth UUIDs without changing legacy profile IDs or business FKs.
BEGIN;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS auth_user_id uuid;
CREATE UNIQUE INDEX IF NOT EXISTS users_auth_user_id_unique
  ON public.users(auth_user_id) WHERE auth_user_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.sync_user_auth_identity() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF nullif(NEW.legacy_data->>'authUserId','') IS NOT NULL THEN
    NEW.auth_user_id := (NEW.legacy_data->>'authUserId')::uuid;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS users_sync_auth_identity ON public.users;
CREATE TRIGGER users_sync_auth_identity
  BEFORE INSERT OR UPDATE OF legacy_data ON public.users
  FOR EACH ROW EXECUTE FUNCTION public.sync_user_auth_identity();
COMMIT;
