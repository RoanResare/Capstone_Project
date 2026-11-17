const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { PGlite } = require("@electric-sql/pglite");

const migrationPath = path.resolve(__dirname, "../../supabase/migrations/202611020001_disable_auth_profile_autoprovision.sql");
const migrationSql = fs.readFileSync(migrationPath, "utf8");

test("Auth profile migration is idempotent, preserves rows, and leaves profile provisioning to backend workflows", async (t) => {
  const db = new PGlite();
  t.after(() => db.close());

  await db.exec(`
    CREATE SCHEMA auth;
    CREATE SCHEMA app_private;
    CREATE TABLE auth.users (
      id uuid PRIMARY KEY,
      email text NOT NULL,
      raw_user_meta_data jsonb NOT NULL DEFAULT '{}'::jsonb
    );
    CREATE TABLE public.users (
      id uuid PRIMARY KEY,
      legacy_id text UNIQUE,
      email text,
      role text,
      account_status text,
      auth_user_id uuid UNIQUE,
      legacy_data jsonb NOT NULL DEFAULT '{}'::jsonb
    );
    CREATE VIEW app_private.users_relational AS
      SELECT coalesce(legacy_id, id::text) AS id, legacy_data AS data FROM public.users;
    CREATE FUNCTION public.handle_new_user() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      INSERT INTO public.users(id, email, role, account_status, auth_user_id, legacy_data)
      VALUES (NEW.id, NEW.email, CASE WHEN NEW.email = 'admin@example.test' THEN 'admin' ELSE 'staff' END,
        'active', NEW.id, jsonb_build_object('uid', NEW.id, 'email', NEW.email,
          'role', CASE WHEN NEW.email = 'admin@example.test' THEN 'admin' ELSE 'staff' END,
          'accountStatus', 'active'));
      RETURN NEW;
    END;
    $$;
    CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users
      FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

    -- Existing business records stand in for rows that must survive untouched.
    INSERT INTO public.users(id, legacy_id, email, role, account_status, legacy_data)
      VALUES ('10000000-0000-0000-0000-000000000001', 'existing-admin', 'admin@example.test', 'admin', 'active',
        '{"uid":"existing-admin","role":"admin","accountStatus":"active"}');
  `);

  // Reproduce the production bug first: every non-whitelisted Auth identity is made active Staff.
  const customerId = "20000000-0000-0000-0000-000000000001";
  await db.query("INSERT INTO auth.users(id,email,raw_user_meta_data) VALUES($1,$2,$3::jsonb)", [
    customerId, "customer@example.test", JSON.stringify({ role: "admin" }),
  ]);
  const vulnerable = await db.query("SELECT role, account_status FROM public.users WHERE auth_user_id=$1", [customerId]);
  assert.deepEqual(vulnerable.rows, [{ role: "staff", account_status: "active" }]);

  // Existing records are captured by key and must remain unchanged by applying the migration.
  const before = await db.query("SELECT id, legacy_id, email, role, account_status, legacy_data FROM public.users ORDER BY id");
  await db.exec(migrationSql);
  await db.exec(migrationSql);
  const after = await db.query("SELECT id, legacy_id, email, role, account_status, legacy_data FROM public.users ORDER BY id");
  assert.deepEqual(after.rows, before.rows);

  // Supabase Auth inserts no longer make profiles, regardless of untrusted metadata.
  const newCustomerId = "30000000-0000-0000-0000-000000000001";
  await db.query("INSERT INTO auth.users(id,email,raw_user_meta_data) VALUES($1,$2,$3::jsonb)", [
    newCustomerId, "new-customer@example.test", JSON.stringify({ role: "admin" }),
  ]);
  const authProfileCount = await db.query("SELECT count(*)::int AS count FROM app_private.users_relational WHERE id=$1", [newCustomerId]);
  assert.equal(authProfileCount.rows[0].count, 0);

  // The registration controller's explicit backend write creates exactly one pending customer profile.
  await db.query(`INSERT INTO public.users(id,email,role,account_status,auth_user_id,legacy_data)
    VALUES($1,$2,'customer','inactive',$1,$3::jsonb)`, [newCustomerId, "new-customer@example.test",
    JSON.stringify({ uid: newCustomerId, authUserId: newCustomerId, email: "new-customer@example.test",
      role: "customer", accountStatus: "inactive", status: "inactive", emailVerified: false,
      verificationStatus: "pending" })]);
  const customer = await db.query("SELECT data->>'role' AS role, data->>'accountStatus' AS status, data->>'verificationStatus' AS verification FROM app_private.users_relational WHERE id=$1", [newCustomerId]);
  assert.deepEqual(customer.rows, [{ role: "customer", status: "inactive", verification: "pending" }]);

  // The authorized employee workflow can still create a Staff identity and profile explicitly.
  const employeeId = "40000000-0000-0000-0000-000000000001";
  await db.query("INSERT INTO auth.users(id,email,raw_user_meta_data) VALUES($1,$2,$3::jsonb)", [
    employeeId, "employee@example.test", JSON.stringify({ role: "customer" }),
  ]);
  const employeeAuthProfileCount = await db.query("SELECT count(*)::int AS count FROM app_private.users_relational WHERE id=$1", [employeeId]);
  assert.equal(employeeAuthProfileCount.rows[0].count, 0);
  await db.query(`INSERT INTO public.users(id,email,role,account_status,auth_user_id,legacy_data)
    VALUES($1,$2,'staff','active',$1,$3::jsonb)`, [employeeId, "employee@example.test",
    JSON.stringify({ uid: employeeId, authUserId: employeeId, email: "employee@example.test",
      role: "staff", accountStatus: "active" })]);
  const employee = await db.query("SELECT data->>'role' AS role, data->>'accountStatus' AS status FROM app_private.users_relational WHERE id=$1", [employeeId]);
  assert.deepEqual(employee.rows, [{ role: "staff", status: "active" }]);

  const trigger = await db.query(`SELECT tgenabled, tgfoid='public.handle_new_user()'::regprocedure::oid AS bound
    FROM pg_trigger WHERE tgrelid='auth.users'::regclass AND tgname='on_auth_user_created' AND NOT tgisinternal`);
  assert.deepEqual(trigger.rows, [{ tgenabled: "O", bound: true }]);
});
