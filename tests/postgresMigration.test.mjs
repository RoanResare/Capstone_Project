import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { PGlite } from "@electric-sql/pglite";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";

const require = createRequire(import.meta.url);
const { createPostgresDatabase } = require("../server/src/database/postgres.js");
const { encode, decode } = require("../server/src/database/values.js");
const serverRequire = createRequire(new URL("../server/package.json", import.meta.url));
const { Timestamp, GeoPoint } = serverRequire("firebase-admin/firestore");
const { assertRead, assertWrite } = require("../server/src/database/browserAccess.js");

async function fixture() {
  const pg = new PGlite();
  await pg.exec(`CREATE ROLE anon; CREATE ROLE authenticated;
    CREATE SCHEMA auth;
    CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS
    $$ SELECT coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb $$;`);
  await pg.exec(readFileSync(new URL("../supabase/migrations/202610280001_business_data.sql", import.meta.url), "utf8"));
  await pg.exec(readFileSync(new URL("../supabase/migrations/202610280002_public_relational_tables.sql", import.meta.url), "utf8"));
  // PGlite is one PostgreSQL session. Serialize test leases; production uses
  // independent node-pg sessions and the adapter's database advisory lock.
  let previous = Promise.resolve();
  const pool = { query: (text, params) => pg.query(text, params), connect: async () => {
    const wait = previous; let unlock;
    previous = new Promise(resolve => { unlock = resolve; });
    await wait;
    return { query: (text, params) => pg.query(text, params), release: unlock };
  }, end: () => pg.close() };
  return { pg, pool, db: createPostgresDatabase(pool) };
}

test("PostgreSQL schema and adapter retain types, IDs, nested merges, pagination and rollback", async () => {
  const { pg, db } = await fixture();
  try {
    const ref = db.collection("pets").doc("original-pet-id");
    const time = new Timestamp(1700000000, 123456789);
    const input = { petName: "Milo", nested: { first: 1, second: ["a", "b"] }, createdAt: time,
      point: new GeoPoint(14, 120), bytes: Buffer.from([1, 2]), reserved: { __furfection_type__: "timestamp", seconds: 1 }, missing: null };
    await ref.set(input);
    const loaded = (await ref.get()).data();
    assert.equal(loaded.createdAt.nanoseconds, 123456789);
    assert.equal(loaded.createdAt.toMillis(), time.toMillis());
    assert.deepEqual(loaded.bytes, input.bytes);
    assert.deepEqual(loaded.reserved, input.reserved);
    assert.equal(loaded.point.latitude, 14);
    await ref.set({ nested: { first: 2 } }, { merge: true });
    assert.deepEqual((await ref.get()).data().nested, { first: 2, second: ["a", "b"] });
    await db.collection("pets").doc("z").set({ petName: "Other" });
    const page = await db.collection("pets").orderBy("__name__").limit(1).get();
    assert.equal(page.docs[0].id, "original-pet-id");
    const next = await db.collection("pets").orderBy("__name__").startAfter(page.docs[0]).limit(1).get();
    assert.equal(next.docs[0].id, "z");
    await assert.rejects(db.runTransaction(async tx => { tx.set(ref, { petName: "broken" }); throw new Error("abort"); }), /abort/);
    assert.equal((await ref.get()).data().petName, "Milo");
    const batch = db.batch(); batch.set(ref, { petName: "new" }, { merge: true }); batch.update(db.collection("pets").doc("absent"), { bad: true });
    await assert.rejects(batch.commit(), /does not exist/);
    assert.equal((await ref.get()).data().petName, "Milo");
    assert.throws(() => db.collection("users; DROP TABLE users"), /Unsupported/);
    assert.throws(() => db.compile(db.collection("pets").where("name');--", "==", "x")), /Unsupported/);
    assert.deepEqual(encode(decode(encode(input))), encode(input));
  } finally { await pg.close(); }
});

test("PostgreSQL queries match filters, missing-field exclusion, tied cursors and nanosecond comparisons", async () => {
  const { pg, db } = await fixture();
  try {
    const batch = db.batch();
    for (const id of ["a", "b", "c"]) batch.set(db.collection("appointments").doc(id), { status: "Pending", scheduleDate: "2030-01-01", createdAt: new Timestamp(10, id === "a" ? 1 : 2) });
    batch.set(db.collection("appointments").doc("missing"), { status: "Completed" });
    await batch.commit();
    assert.equal((await db.collection("appointments").where("status", "in", ["Pending", "Confirmed"]).get()).size, 3);
    const query = db.collection("appointments").orderBy("scheduleDate").limit(1);
    const first = (await query.get()).docs[0];
    assert.equal(first.id, "a");
    assert.equal((await query.startAfter(first).get()).docs[0].id, "b");
    assert.equal((await db.collection("appointments").where("createdAt", "<", new Timestamp(10, 2)).get()).docs[0].id, "a");
    assert.equal((await db.collection("appointments").orderBy("scheduleDate").get()).size, 3);
  } finally { await pg.close(); }
});

test("RLS denies anonymous/private-table access and isolates active customer realtime events", async () => {
  const { pg, db } = await fixture();
  try {
    await db.collection("users").doc("alice").set({ uid: "alice", role: "customer", accountStatus: "active" });
    await db.collection("users").doc("bob").set({ uid: "bob", role: "customer", accountStatus: "active" });
    await db.collection("pets").doc("a").set({ customerId: "alice" });
    await db.collection("pets").doc("b").set({ customerId: "bob" });
    await pg.exec("SET ROLE anon");
    await assert.rejects(pg.query("SELECT * FROM public.database_changes"));
    await pg.exec("RESET ROLE; SET ROLE authenticated");
    await pg.query("SELECT set_config('request.jwt.claims',$1,false)", [JSON.stringify({ sub: "alice", iss: "furfection-database", firebase_iat: 100 })]);
    const events = await pg.query("SELECT * FROM public.database_changes WHERE collection_name='pets'");
    assert.equal(events.rows.length, 1);
    assert.equal(events.rows[0].document_id, "a");
    await assert.rejects(pg.query("SELECT * FROM app_private.pets"));
    await assert.rejects(pg.query("INSERT INTO public.database_changes(collection_name,document_id,operation) VALUES ('pets','fake','INSERT')"));
    await pg.exec("RESET ROLE");
    await db.collection("sessionSecurity").doc("alice").set({ revokedBefore: 0 });
    await db.collection("users").doc("alice").set({ accountStatus: "suspended" }, { merge: true });
    await pg.exec("SET ROLE authenticated");
    assert.equal((await pg.query("SELECT * FROM public.database_changes")).rows.length, 0);
    await pg.exec("RESET ROLE");
    await db.collection("users").doc("alice").set({ accountStatus: "active" }, { merge: true });
    await db.collection("sessionSecurity").doc("alice").set({ revokedBefore: 100 });
    await pg.exec("SET ROLE authenticated");
    assert.equal((await pg.query("SELECT * FROM public.database_changes")).rows.length, 0);
    await pg.exec("RESET ROLE");
  } finally { await pg.close(); }
});

test("existing OTP and authentication-attempt logic persists locks and one-time consumption in PostgreSQL", async t => {
  const { pg, db } = await fixture();
  const configPath = serverRequire.resolve("./src/config/firebaseAdmin.js");
  const paths = [configPath, serverRequire.resolve("./src/services/authAttempts.service.js"), serverRequire.resolve("./src/services/otp.service.js")];
  const originals = new Map(paths.map(path => [path, serverRequire.cache[path]]));
  serverRequire.cache[configPath] = { id: configPath, filename: configPath, loaded: true, exports: { db, admin: { firestore: { Timestamp } } } };
  for (const path of paths.slice(1)) delete serverRequire.cache[path];
  t.mock.method(console, "info", () => {});
  t.mock.method(console, "warn", () => {});
  try {
    const attempts = serverRequire("./src/services/authAttempts.service.js");
    for (let i = 0; i < 4; i++) await attempts.recordFailedAttempt("login", "synthetic");
    await assert.rejects(attempts.recordFailedAttempt("login", "synthetic"), { statusCode: 429 });
    await assert.rejects(attempts.assertAttemptsAllowed("login", "synthetic"), { statusCode: 429 });
    await assert.rejects(attempts.resetAttempts("login", "synthetic"), { statusCode: 429 });
    const { hashOtpCode } = serverRequire("./src/utils/otp");
    const { verifyOtpCode } = serverRequire("./src/services/otp.service.js");
    const user = { uid: "otp-user", email: "otp@example.invalid", role: "admin" };
    await db.collection("admin_staff_otp").doc("challenge").set({ otpId: "challenge", userId: user.uid, email: user.email, role: user.role,
      otpCode: hashOtpCode("123456"), isUsed: false, attemptCount: 0,
      createdAt: Timestamp.now(), expiresAt: Timestamp.fromMillis(Date.now() + 60_000) });
    assert.equal((await verifyOtpCode({ otpId: "challenge", otpCode: "123456", user })).status, "verified");
    assert.equal((await db.collection("admin_staff_otp").doc("challenge").get()).data().isUsed, true);
    await assert.rejects(verifyOtpCode({ otpId: "challenge", otpCode: "123456", user }));
  } finally {
    for (const [path, original] of originals) if (original) serverRequire.cache[path] = original; else delete serverRequire.cache[path];
    await pg.close();
  }
});

test("browser policy preserves ownership and blocks role escalation and business-write bypasses", () => {
  const identity = { uid: "alice", user: { uid: "alice", role: "customer" }, claims: { email: "alice@example.com" } };
  assertRead("pets", "a", { customerId: "alice" }, identity);
  assert.throws(() => assertRead("pets", "b", { customerId: "bob" }, identity));
  assert.throws(() => assertRead("sessionSecurity", "alice", {}, identity));
  const before = { uid: "alice", role: "customer", accountStatus: "active", fullName: "A" };
  assertWrite("users", "alice", before, { ...before, fullName: "Alice" }, identity, "update");
  assert.throws(() => assertWrite("users", "alice", before, { ...before, role: "admin" }, identity, "update"));
  assert.throws(() => assertWrite("appointments", "a", {}, { status: "Approved" }, identity, "update"));
  assert.throws(() => assertWrite("usernames", "bob", { uid: "bob" }, { uid: "alice" }, identity, "set"));
  assert.throws(() => assertWrite("notifications", "a", null, { targetUserId: "alice" }, identity, "set"));
  const notice = { targetUserId: "alice", message: "Unchanged", readBy: ["bob"] };
  assertWrite("notifications", "a", notice, { ...notice, readBy: ["bob", "alice"] }, identity, "update");
  assert.throws(() => assertWrite("notifications", "a", notice, { ...notice, readBy: ["alice"] }, identity, "update"));
  assert.throws(() => assertWrite("notifications", "a", notice, { ...notice, message: "Forged" }, identity, "update"));
});

test("staging import is idempotent, preserves unknown subcollections and validates hashes/counts", async () => {
  const { pg, pool } = await fixture();
  const directory = await mkdtemp(join(tmpdir(), "furfection-migration-test-"));
  try {
    const { importRows, validateRows, assertManifest, externalFile } = require("../server/scripts/postgresMigration.js");
    const filename = join(directory, "synthetic.ndjson");
    const rows = [
      { path: "users/synthetic", data: { uid: "synthetic", role: "customer", email: "synthetic@example.invalid" } },
      { path: "pets/synthetic-pet", data: { customerId: "synthetic", tags: ["nested"], createdAt: encode(new Timestamp(10, 999)) } },
      { path: "unknown/missing/children/document", data: { value: "preserved" } },
    ];
    const content = rows.map(row => JSON.stringify(row) + "\n").join("");
    await writeFile(filename, content, { mode: 0o600 });
    await writeFile(filename + ".manifest.json", JSON.stringify({ formatVersion: 1, documents: 3, sha256: createHash("sha256").update(content).digest("hex") }));
    assert.equal((await importRows(pool, filename)).imported, 3);
    assert.equal((await importRows(pool, filename)).imported, 3);
    const report = await validateRows(pool, filename);
    assert.equal(report.valid, true);
    assert.equal(report.verified, 3);
    assert.equal((await pg.query("SELECT count(*) FROM app_private.firestore_archive")).rows[0].count, 1);
    await pg.query("UPDATE public.pets SET legacy_data = '{}'::jsonb");
    assert.equal((await validateRows(pool, filename)).mismatched, 1);
    await writeFile(filename, content + "\n");
    await assert.rejects(assertManifest(filename), /checksum/);
    assert.throws(() => externalFile(join(process.cwd(), "backup.ndjson")), /outside/);
  } finally { await pg.close(); await rm(directory, { recursive: true, force: true }); }
});

test("existing booking and pet controllers execute atomically against PostgreSQL", async () => {
  const { pg, db } = await fixture();
  const configPath = serverRequire.resolve("./src/config/firebaseAdmin.js");
  const previousConfig = serverRequire.cache[configPath];
  serverRequire.cache[configPath] = { id: configPath, filename: configPath, loaded: true, exports: { db } };
  const appointmentPath = serverRequire.resolve("./src/controllers/appointment.controller.js");
  const petPath = serverRequire.resolve("./src/controllers/pet.controller.js");
  const oldAppointment = serverRequire.cache[appointmentPath], oldPet = serverRequire.cache[petPath];
  delete serverRequire.cache[appointmentPath]; delete serverRequire.cache[petPath];
  try {
    const { saveAppointment } = serverRequire(appointmentPath);
    const { savePet, deletePet } = serverRequire(petPath);
    const user = { uid: "synthetic", role: "customer", email: "synthetic@example.invalid", accountStatus: "active" };
    const response = { json() {} };
    await savePet({ params: { id: "pet" }, auth: { user }, body: { id: "pet", petName: "Milo", gender: "Male", petType: "Cat", breed: "Mixed", customerId: user.uid } }, response);
    assert.equal((await db.collection("pets").doc("pet").get()).data().customerId, user.uid);
    await db.collection("availabilitySlots").doc("slot").set({ isOpen: true, date: "2030-01-05", time: "09:00", capacity: 1 });
    const body = { id: "first", customerId: user.uid, petRecordId: "pet", status: "Pending", serviceId: "vaccination", serviceIds: ["vaccination"],
      clinicalSelections: [{ category: "vaccination", serviceId: "4-in-1" }, { category: "vaccination", serviceId: "doctors-fee" }], slotId: "slot", scheduleDate: "2030-01-05", scheduleTime: "09:00" };
    const outcomes = await Promise.allSettled(["first", "second"].map(id => saveAppointment({ params: { id }, auth: { user }, body: { ...body, id } }, response)));
    assert.equal(outcomes.filter(item => item.status === "fulfilled").length, 1);
    assert.equal(outcomes.filter(item => item.status === "rejected")[0].reason.statusCode, 409);
    assert.equal((await db.collection("appointments").get()).size, 1);
    await deletePet({ params: { id: "pet" }, auth: { user } }, response);
    assert.equal((await db.collection("pets").doc("pet").get()).exists, false);
    assert.equal((await db.collection("appointments").get()).size, 0);
    assert.equal((await db.collection("deletedPets").doc("pet").get()).exists, true);
  } finally {
    if (previousConfig) serverRequire.cache[configPath] = previousConfig; else delete serverRequire.cache[configPath];
    if (oldAppointment) serverRequire.cache[appointmentPath] = oldAppointment; else delete serverRequire.cache[appointmentPath];
    if (oldPet) serverRequire.cache[petPath] = oldPet; else delete serverRequire.cache[petPath];
    await pg.close();
  }
});
