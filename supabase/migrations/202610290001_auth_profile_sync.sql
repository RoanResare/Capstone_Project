-- Keep Supabase Auth identity and public profile fields synchronized for rows
-- written through the legacy_data compatibility adapter.
BEGIN;

ALTER TABLE public.users ADD COLUMN IF NOT EXISTS auth_user_id uuid;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS account_status text DEFAULT 'active';
CREATE UNIQUE INDEX IF NOT EXISTS users_auth_user_id_unique
  ON public.users(auth_user_id) WHERE auth_user_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.sync_user_auth_identity() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF nullif(NEW.legacy_data->>'authUserId','') IS NOT NULL THEN
    NEW.auth_user_id := (NEW.legacy_data->>'authUserId')::uuid;
  END IF;
  IF NEW.auth_user_id IS NOT NULL THEN
    NEW.legacy_data := jsonb_set(NEW.legacy_data, '{authUserId}', to_jsonb(NEW.auth_user_id::text), true);
  END IF;
  IF nullif(NEW.legacy_data->>'accountStatus','') IS NOT NULL THEN
    NEW.account_status := NEW.legacy_data->>'accountStatus';
  END IF;
  IF NEW.account_status IS NOT NULL THEN
    NEW.legacy_data := jsonb_set(NEW.legacy_data, '{accountStatus}', to_jsonb(NEW.account_status), true);
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS users_sync_auth_identity ON public.users;
CREATE TRIGGER users_sync_auth_identity
  BEFORE INSERT OR UPDATE OF legacy_data, auth_user_id, account_status ON public.users
  FOR EACH ROW EXECUTE FUNCTION public.sync_user_auth_identity();

COMMIT;
