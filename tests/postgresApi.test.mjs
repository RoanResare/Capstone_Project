import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import { randomBytes } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";

const require = createRequire(new URL("../server/package.json", import.meta.url));
const express = require("express"), jwt = require("jsonwebtoken");
const { ApiError } = require("../server/src/utils/ApiError.js");
const { asyncHandler } = require("../server/src/utils/asyncHandler.js");
const { createPostgresDatabase } = require("../server/src/database/postgres.js");
const values = require("../server/src/database/values.js");
process.env.DATABASE_URL ||= "postgres://test:test@127.0.0.1:5432/test";
const policy = require("../server/src/database/browserAccess.js");

test("PostgreSQL API authenticates Supabase users, enforces ownership, protects writes and issues restricted realtime JWTs", async () => {
  const pg = new PGlite();
  await pg.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE SCHEMA auth;
    CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$ SELECT '{}'::jsonb $$;`);
  await pg.exec(readFileSync(new URL("../supabase/migrations/202610280001_business_data.sql", import.meta.url), "utf8"));
  await pg.exec(readFileSync(new URL("../supabase/migrations/202610280002_public_relational_tables.sql", import.meta.url), "utf8"));
  const pool = { query: (...args) => pg.query(...args), connect: async () => ({ query: (...args) => pg.query(...args), release() {} }) };
  const db = createPostgresDatabase(pool);
  const uid = "7caeb3fd-d955-49cb-a8d9-17f0e75d8620";
  await db.collection("users").doc(uid).set({ uid, authUserId: uid, role: "customer", email: "alice@example.invalid", fullName: "Alice", accountStatus: "active", passwordHash: "do-not-expose" });
  await db.collection("pets").doc("alice-pet").set({ customerId: uid, petName: "Milo" });
  await db.collection("pets").doc("bob-pet").set({ customerId: "another-user", petName: "Other" });

  let verified = 0, securityChecks = 0;
  const claims = { uid, sub: uid, email: "alice@example.invalid", iat: 100 };
  const getUserByAuthId = async id => {
    const found = await db.collection("users").where("authUserId", "==", id).limit(1).get();
    return found.empty ? null : { ...found.docs[0].data(), uid: found.docs[0].id };
  };
  const getUserByUid = async id => {
    const found = await db.collection("users").doc(id).get();
    return found.exists ? found.data() : null;
  };
  const verifyToken = asyncHandler(async (req, _res, next) => {
    if (req.headers.authorization !== "Bearer supabase-token") throw new ApiError(401, "Invalid Supabase token.");
    req.auth = { claims, user: await getUserByAuthId(uid) };
    next();
  });
  const dependencies = {
    express, jsonwebtoken: jwt, "../config/postgresDatabase": { db },
    "../utils/ApiError": { ApiError }, "../utils/asyncHandler": { asyncHandler },
    "../middlewares/authenticate": { verifyToken },
    "../services/sessionSecurity.service": { validateSessionSecurity: async () => { securityChecks++; } },
    "../services/user.service": { getUserByAuthId, getUserByUid },
    "../services/scheduleRecords.service": { listRecords: async (name, user) => ({ records: (await db.collection(name).where("customerId", "==", user.uid).get()).docs.map(doc => ({ ...doc.data(), id: doc.id })) }) },
    "../database/browserAccess": policy, "../database/values": values,
    "../services/supabaseAuth.service": {
      isSupabaseAccessToken: token => token === "supabase-token",
      verifySupabaseAccessToken: async () => { verified++; return claims; },
    },
    "../services/token.service": { verifyAccessToken: () => { throw new ApiError(401, "Invalid server token."); } },
  };
  const context = { module: { exports: {} }, process: { env: { SUPABASE_JWT_SECRET: randomBytes(32).toString("hex") } },
    require: name => { if (dependencies[name]) return dependencies[name]; throw new Error(name); } };
  vm.runInNewContext(readFileSync(new URL("../server/src/routes/database.routes.js", import.meta.url), "utf8"), context);
  const app = express(); app.use(express.json()); app.use("/database", context.module.exports);
  app.use((error, _req, res, _next) => res.status(error.statusCode || 500).json({ message: error.message }));
  const server = app.listen(0, "127.0.0.1");
  await new Promise(resolve => server.once("listening", resolve));
  const base = `http://127.0.0.1:${server.address().port}/database`;
  const post = (route, body, token = "supabase-token") => fetch(`${base}/${route}`, { method: "POST", headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) });
  try {
    assert.equal((await post("read", { collection: "pets", id: "alice-pet" })).status, 200);
    assert.equal((await post("read", { collection: "pets", id: "bob-pet" })).status, 403);
    assert.equal((await post("read", { collection: "pets", id: "alice-pet" }, "bad-token")).status, 401);
    assert.equal((await post("read", { collection: "pets", id: "alice-pet" }, "")).status, 403);
    const profile = await (await post("read", { collection: "users", id: uid })).json();
    assert.equal(profile.data.passwordHash, undefined);
    assert.equal((await post("write", { writes: [{ collection: "users", id: uid, operation: "update", data: { role: "admin" } }] })).status, 403);
    assert.equal((await post("write", { writes: [{ collection: "appointments", id: "bypass", operation: "set", data: { status: "Approved" } }] })).status, 403);
    assert.equal((await post("write", { writes: [{ collection: "users", id: uid, operation: "update", data: { fullName: "Updated" } }] })).status, 200);
    const tokenResponse = await fetch(`${base}/token`, { headers: { Authorization: "Bearer supabase-token" } });
    assert.equal(tokenResponse.status, 200);
    const decoded = jwt.verify((await tokenResponse.json()).token, context.process.env.SUPABASE_JWT_SECRET, { algorithms: ["HS256"], issuer: "furfection-database", audience: "authenticated" });
    assert.equal(decoded.role, "authenticated");
    assert.equal(decoded.sub, uid);
    assert.equal(decoded.auth_iat, 100);
    assert.equal(decoded.exp - decoded.iat, 300);
    assert.equal(decoded.passwordHash, undefined);
    assert.ok(verified > 0 && securityChecks > 0);
  } finally { await new Promise(resolve => server.close(resolve)); await pg.close(); }
});
