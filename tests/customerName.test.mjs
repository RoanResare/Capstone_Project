import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { PGlite } from "@electric-sql/pglite";
import { resolveCustomerFullName } from "../shared/customerName.mjs";

const require = createRequire(import.meta.url);
const { createPostgresDatabase } = require("../server/src/database/postgres.js");

test("customer names preserve real input and fall back to username then email prefix", () => {
  assert.equal(resolveCustomerFullName({ fullName: "  María Dela Cruz Jr.  ", username: "maria" }), "María Dela Cruz Jr.");
  assert.equal(resolveCustomerFullName({ fullName: " ", username: " roan_resare ", email: "roan@gmail.com" }), "roan_resare");
  assert.equal(resolveCustomerFullName({ email: " roan.resare@gmail.com " }), "roan.resare");
  assert.equal(resolveCustomerFullName({ full_name: "Roan Resare" }), "Roan Resare");
  assert.equal(resolveCustomerFullName({ role: "admin", email: "roan@gmail.com" }), "roan");
});

test("the registration adapter saves fullName into public.users.full_name and replaces a trigger placeholder", async () => {
  const pg = new PGlite();
  try {
    await pg.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE SCHEMA auth;
      CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$ SELECT '{}'::jsonb $$;`);
    for (const migration of ["202610280001_business_data.sql", "202610280002_public_relational_tables.sql", "202610290001_auth_profile_sync.sql"]) {
      await pg.exec(readFileSync(new URL(`../supabase/migrations/${migration}`, import.meta.url), "utf8"));
    }
    const pool = { query: (...args) => pg.query(...args), connect: async () => ({
      query: (...args) => pg.query(...args), release() {},
    }) };
    const db = createPostgresDatabase(pool);
    const uid = "7caeb3fd-d955-49cb-a8d9-17f0e75d8620";
    await pg.query("INSERT INTO public.users(id,email,full_name,role) VALUES ($1,$2,$3,'customer')",
      [uid, "customer@gmail.com", "Staff User"]);
    await db.collection("users").doc(uid).set({ uid, authUserId: uid, email: "customer@gmail.com",
      fullName: "Roan Resare", username: "roan_resare", role: "customer", accountStatus: "inactive" });
    const result = await pg.query("SELECT full_name, role, legacy_data->>'fullName' AS stored_name FROM public.users WHERE id=$1", [uid]);
    assert.equal(result.rows.length, 1);
    assert.equal(result.rows[0].full_name, "Roan Resare");
    assert.equal(result.rows[0].stored_name, "Roan Resare");
    assert.equal(result.rows[0].role, "customer");
    assert.equal((await db.collection("users").get()).size, 1);
  } finally {
    await pg.close();
  }
});
