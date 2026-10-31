const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");

const migration = fs.readFileSync(path.join(__dirname, "../../supabase/migrations/202611030001_trusted_device_credentials.sql"), "utf8");
const collections = require("../src/database/collections");

test("trusted-device migration creates an idempotent private server-side store", () => {
  assert.match(migration, /BEGIN\s*;/i);
  assert.match(migration, /CREATE SCHEMA IF NOT EXISTS app_private/i);
  assert.doesNotMatch(migration, /REVOKE ALL ON SCHEMA app_private FROM [^;]*authenticated/i);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS app_private\.trusted_devices/i);
  assert.match(migration, /id text COLLATE "C" PRIMARY KEY/i);
  assert.match(migration, /data jsonb NOT NULL CHECK \(jsonb_typeof\(data\) = 'object'\)/i);
  assert.match(migration, /updated_at timestamptz NOT NULL DEFAULT clock_timestamp\(\)/i);
  assert.match(migration, /ALTER TABLE app_private\.trusted_devices ENABLE ROW LEVEL SECURITY/i);
  assert.match(migration, /REVOKE ALL ON app_private\.trusted_devices FROM PUBLIC, anon, authenticated/i);
  assert.match(migration, /trusted_devices_user_role_idx/i);
  assert.match(migration, /trusted_devices_expiry_idx/i);
  assert.match(migration, /COMMIT\s*;/i);
  assert.equal(collections.tableFor("trustedDevices"), "app_private.trusted_devices");
  assert.throws(() => collections.tableFor("customersTrustedDevices"), /Unsupported database collection/);
});

test("trusted-device storage is not exposed through public schema grants or user data changes", () => {
  assert.doesNotMatch(migration, /GRANT\s+[^;]+\s+ON\s+app_private\.trusted_devices/i);
  assert.doesNotMatch(migration, /INSERT\s+INTO|UPDATE\s+app_private\.trusted_devices|DELETE\s+FROM/i);
});
