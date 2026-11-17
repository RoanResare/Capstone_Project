BEGIN;

CREATE SCHEMA IF NOT EXISTS app_private;
-- Preserve the existing authenticated schema USAGE grant used by Realtime
-- policies; this table itself remains unavailable to client roles.
REVOKE ALL ON SCHEMA app_private FROM PUBLIC, anon;

CREATE TABLE IF NOT EXISTS app_private.trusted_devices (
  id text COLLATE "C" PRIMARY KEY
    CHECK (id <> '' AND position('/' in id) = 0),
  data jsonb NOT NULL CHECK (jsonb_typeof(data) = 'object'),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

ALTER TABLE app_private.trusted_devices ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON app_private.trusted_devices FROM PUBLIC, anon, authenticated;
CREATE INDEX IF NOT EXISTS trusted_devices_user_role_idx
  ON app_private.trusted_devices ((data->>'userId'), (data->>'role'));
CREATE INDEX IF NOT EXISTS trusted_devices_expiry_idx
  ON app_private.trusted_devices ((data->>'expiresAt'));

COMMIT;
