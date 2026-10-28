import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import { randomBytes } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
const require = createRequire(new URL("../server/package.json", import.meta.url));
const express = require("express"), jwt = require("jsonwebtoken");
const { ApiError } = require("./src/utils/ApiError");
const { asyncHandler } = require("./src/utils/asyncHandler");
const { createPostgresDatabase } = require("./src/database/postgres");
const values = require("./src/database/values");
const policy = require("./src/database/browserAccess");

test("PostgreSQL HTTP routes authenticate Firebase callers, enforce ownership, protect writes and issue restricted realtime JWTs", async () => {
  const pg = new PGlite();
  await pg.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE SCHEMA auth;
    CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$ SELECT '{}'::jsonb $$;`);
  await pg.exec(readFileSync(new URL("../supabase/migrations/202610280001_business_data.sql", import.meta.url), "utf8"));
  await pg.exec(readFileSync(new URL("../supabase/migrations/202610280002_public_relational_tables.sql", import.meta.url), "utf8"));
  const pool = { query: (...args) => pg.query(...args), connect: async () => ({ query: (...args) => pg.query(...args), release() {} }) };
  const db = createPostgresDatabase(pool);
  await db.collection("users").doc("alice").set({ uid: "alice", role: "customer", email: "alice@example.invalid", fullName: "Alice", accountStatus: "active", passwordHash: "do-not-expose" });
  await db.collection("pets").doc("alice-pet").set({ customerId: "alice", petName: "Milo" });
  await db.collection("pets").doc("bob-pet").set({ customerId: "bob", petName: "Other" });
  let verified = 0, securityChecks = 0;
  const claims = { uid: "alice", sub: "alice", email: "alice@example.invalid", iat: 100 };
  const auth = { async verifyIdToken(token, checkRevoked) {
    assert.equal(checkRevoked, true); verified++;
    if (token !== "synthetic-firebase-token") throw new Error("invalid");
    return claims;
  } };
  const dependencies = {
    express, jsonwebtoken: jwt, "../config/firebaseAdmin": { db, auth },
    "../utils/ApiError": { ApiError }, "../utils/asyncHandler": { asyncHandler },
    "../middlewares/authenticate": { verifyToken: asyncHandler(async (req, _res, next) => {
      const token = req.headers.authorization?.slice(7);
      const claims = await auth.verifyIdToken(token, true);
      req.auth = { claims, user: (await db.collection("users").doc(claims.uid).get()).data() }; next();
    }) },
    "../services/sessionSecurity.service": { validateSessionSecurity: async () => { securityChecks++; } },
    "../services/user.service": { getUserByUid: async uid => (await db.collection("users").doc(uid).get()).data() },
    "../services/scheduleRecords.service": { listRecords: async (_name, user) => ({ records: (await db.collection("pets").where("customerId", "==", user.uid).get()).docs.map(doc => ({ ...doc.data(), id: doc.id })) }) },
    "../database/browserAccess": policy, "../database/values": values,
  };
  const context = { module: { exports: {} }, process: { env: { SUPABASE_JWT_SECRET: randomBytes(32).toString("hex") } },
    require: name => { if (dependencies[name]) return dependencies[name]; throw new Error(name); } };
  vm.runInNewContext(readFileSync(new URL("../server/src/routes/database.routes.js", import.meta.url), "utf8"), context);
  const app = express(); app.use(express.json()); app.use("/database", context.module.exports);
  app.use((error, _req, res, _next) => res.status(error.statusCode || 500).json({ message: error.message }));
  const server = app.listen(0, "127.0.0.1");
  await new Promise(resolve => server.once("listening", resolve));
  const base = `http://127.0.0.1:${server.address().port}/database`;
  const post = (route, body, token = "synthetic-firebase-token") => fetch(`${base}/${route}`, { method: "POST", headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) });
  try {
    assert.equal((await post("read", { collection: "pets", id: "alice-pet" })).status, 200);
    assert.equal((await post("read", { collection: "pets", id: "bob-pet" })).status, 403);
    assert.equal((await post("read", { collection: "pets", id: "alice-pet" }, "bad-token")).status, 401);
    assert.equal((await post("read", { collection: "pets", id: "alice-pet" }, "")).status, 403);
    const profile = await (await post("read", { collection: "users", id: "alice" })).json();
    assert.equal(profile.data.passwordHash, undefined);
    assert.equal((await post("write", { writes: [{ collection: "users", id: "alice", operation: "update", data: { role: "admin" } }] })).status, 403);
    assert.equal((await post("write", { writes: [{ collection: "appointments", id: "bypass", operation: "set", data: { status: "Approved" } }] })).status, 403);
    assert.equal((await post("write", { writes: [{ collection: "users", id: "alice", operation: "update", data: { fullName: "Updated" } }] })).status, 200);
    const tokenResponse = await fetch(`${base}/token`, { headers: { Authorization: "Bearer synthetic-firebase-token" } });
    assert.equal(tokenResponse.status, 200);
    const decoded = jwt.verify((await tokenResponse.json()).token, context.process.env.SUPABASE_JWT_SECRET, { algorithms: ["HS256"], issuer: "furfection-database", audience: "authenticated" });
    assert.equal(decoded.role, "authenticated");
    assert.equal(decoded.sub, "alice");
    assert.equal(decoded.firebase_iat, 100);
    assert.equal(decoded.exp - decoded.iat, 300);
    assert.equal(decoded.passwordHash, undefined);
    assert.ok(verified > 0 && securityChecks > 0);
  } finally { await new Promise(resolve => server.close(resolve)); await pg.close(); }
});
