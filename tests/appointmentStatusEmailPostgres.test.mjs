import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { PGlite } from "@electric-sql/pglite";
const require = createRequire(new URL("../server/package.json", import.meta.url));
const { createPostgresDatabase } = require("../server/src/database/postgres.js");
const { queueStatusEmail, createStatusEmailWorker } = require("../server/src/services/appointmentStatusEmail.service.js");

test("status email jobs work with the existing unmodified Supabase schema and keep reminder records isolated", async () => {
  const pg = new PGlite();
  try {
    await pg.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE SCHEMA auth;
      CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$ SELECT '{}'::jsonb $$;`);
    await pg.exec(readFileSync(new URL("../supabase/migrations/202610280001_business_data.sql", import.meta.url), "utf8"));
    const pool = { query: (...args) => pg.query(...args), connect: async () => ({ query: (...args) => pg.query(...args), release() {} }) };
    const db = createPostgresDatabase(pool);
    const previous = { status: "Pending", customerId: "customer" };
    const appointment = { id: "appointment", status: "Approved", petName: "Milo", service: "Consultation", scheduleDate: "2030-01-31", scheduleTime: "09:00" };
    const actor = { uid: "staff", role: "staff" };
    await db.collection("appointmentReminders").doc("legacy-reminder").set({ sentAt: "2026-01-01", retryAt: 0 });
    await assert.rejects(db.runTransaction(async transaction => {
      queueStatusEmail({ db, transaction, previous, appointment, actor });
      throw new Error("rollback");
    }), /rollback/);
    assert.equal((await db.collection("appointmentReminders").get()).docs.length, 1);
    await db.runTransaction(transaction => queueStatusEmail({ db, transaction, previous, appointment, actor }));
    const sends = [];
    const worker = createStatusEmailWorker({ db, pause: async () => {}, resolveRecipient: async () => "customer@example.invalid",
      makeEnvelope: (job, to) => ({ to, messageId: job.eventId }), send: async payload => { sends.push(payload); return { id: "accepted" }; } });
    await worker.run(); await worker.run();
    assert.equal(sends.length, 1);
    const jobs = await db.collection("appointmentReminders").where("notificationType", "==", "appointment-status-email").get();
    assert.equal(jobs.docs.length, 1); assert.equal(jobs.docs[0].data().deliveryState, "accepted");
    assert.equal((await db.collection("appointmentReminders").doc("legacy-reminder").get()).data().sentAt, "2026-01-01");
  } finally { await pg.close(); }
});
