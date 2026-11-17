-- Application profiles are provisioned only by the trusted backend workflows.
-- The previous Auth trigger assigned every non-hardcoded email the Staff role
-- and Active status. Auth user_metadata is client-controlled and is not a safe
-- source of Admin/Staff authorization. Keep the trigger installed for
-- compatibility, but make it side-effect free so customer signup and the
-- authorized employee workflow each create exactly one explicitly-role-bound
-- application profile.
--
-- Before applying in production, save the output of this read-only query with
-- the change record. The production function body is not stored in this repo:
-- SELECT pg_get_triggerdef(t.oid, true), pg_get_functiondef(p.oid)
-- FROM pg_trigger AS t JOIN pg_proc AS p ON p.oid=t.tgfoid
-- WHERE t.tgrelid='auth.users'::regclass
--   AND t.tgname='on_auth_user_created' AND NOT t.tgisinternal;
-- Do not restore the captured handler as a rollback; it contains the unsafe
-- role assignment. The safe rollback procedure is to disable this trigger.
BEGIN;

DO $$
DECLARE
  trigger_function oid;
  handler_trigger_count integer;
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

  SELECT count(*) INTO handler_trigger_count
  FROM pg_trigger
  WHERE tgfoid = trigger_function
    AND NOT tgisinternal;

  IF handler_trigger_count <> 1 THEN
    RAISE EXCEPTION 'public.handle_new_user() is attached to % triggers; inspect all attachments before applying this migration.', handler_trigger_count;
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
