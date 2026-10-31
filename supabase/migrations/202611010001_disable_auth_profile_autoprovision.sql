-- Application profiles are provisioned only by the trusted backend workflows.
-- The previous Auth trigger assigned every non-hardcoded email the Staff role
-- and Active status. Auth user_metadata is client-controlled and is not a safe
-- source of Admin/Staff authorization. Keep the trigger installed for
-- compatibility, but make it side-effect free so customer signup and the
-- authorized employee workflow each create exactly one explicitly-role-bound
-- application profile.
BEGIN;

DO $$
DECLARE
  trigger_function oid;
BEGIN
  IF to_regprocedure('public.handle_new_user()') IS NULL THEN
    RAISE EXCEPTION 'Expected public.handle_new_user() was not found; inspect the production Auth trigger before applying this migration.';
  END IF;

  SELECT tgfoid INTO trigger_function
  FROM pg_trigger
  WHERE tgrelid = 'auth.users'::regclass
    AND tgname = 'on_auth_user_created'
    AND NOT tgisinternal;

  IF trigger_function IS NULL THEN
    RAISE EXCEPTION 'Expected auth.users trigger on_auth_user_created was not found; no changes applied.';
  END IF;

  IF trigger_function <> 'public.handle_new_user()'::regprocedure::oid THEN
    RAISE EXCEPTION 'on_auth_user_created does not call public.handle_new_user(); inspect the production trigger before applying this migration.';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  -- Customer and employee application profiles are written by the backend,
  -- which enforces role, identity-link, and activation-state rules.
  RETURN NEW;
END;
$$;

DO $$
DECLARE
  trigger_enabled "char";
  trigger_function oid;
BEGIN
  SELECT tgenabled, tgfoid INTO trigger_enabled, trigger_function
  FROM pg_trigger
  WHERE tgrelid = 'auth.users'::regclass
    AND tgname = 'on_auth_user_created'
    AND NOT tgisinternal;

  IF trigger_enabled IS DISTINCT FROM 'O' THEN
    RAISE EXCEPTION 'on_auth_user_created is not enabled after migration; inspect the trigger state.';
  END IF;
  IF trigger_function IS DISTINCT FROM 'public.handle_new_user()'::regprocedure::oid THEN
    RAISE EXCEPTION 'on_auth_user_created is not bound to the corrected handler.';
  END IF;
END $$;

COMMIT;
