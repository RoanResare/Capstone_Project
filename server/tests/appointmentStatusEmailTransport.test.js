const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const Module = require("node:module");
const path = require("node:path");
const { env } = require("../src/config/env");
const { createStatusEmailWorker } = require("../src/services/appointmentStatusEmail.service");

test("status email retries reuse the exact Resend wire payload and idempotency key", async () => {
  const originalFetch = global.fetch, originalMail = { ...env.mail }, originalRuntime = { ...env.runtime };
  let now = 1793606400000;
  let job = { notificationType: "appointment-status-email", eventId: "isolated-status-event", appointmentId: "booking", customerId: "customer", status: "Approved",
    details: { petName: "Milo", service: "Consultation", scheduleDate: "2030-02-01", scheduleTime: "09:00", reason: "" }, attempts: 0, deliveryState: "pending", retryAt: now, leaseUntil: 0 };
  const ref = { id: "event" };
  const query = { where() { return this; }, orderBy() { return this; }, limit() { return this; }, get: async () => ({ docs: job.deliveryState === "pending" ? [{ ref, id: "event", data: () => job }] : [] }) };
  const db = { collection: () => query, runTransaction: action => action({ get: async () => ({ data: () => job }), set: (_ref, patch) => { job = { ...job, ...patch }; } }) };
  const requests = [];
  try {
    Object.assign(env.mail, { apiKey: "re_test_only", fromEmail: "noreply@charmingfurfectionpetscareservices.online", fromName: "Clinic" });
    Object.assign(env.runtime, { mailDeliveryMode: "resend", mailDeliveryReady: true });
    global.fetch = async (url, options) => {
      assert.equal(String(url), "https://api.resend.com/emails");
      requests.push({ key: new Headers(options.headers).get("idempotency-key"), payload: JSON.parse(options.body) });
      return requests.length === 1
        ? new Response(JSON.stringify({ name: "application_error", message: "simulated failure" }), { status: 500, headers: { "Content-Type": "application/json" } })
        : new Response(JSON.stringify({ id: "status-provider-id" }), { status: 200, headers: { "Content-Type": "application/json" } });
    };
    const worker = createStatusEmailWorker({ db, clock: () => now, resolveRecipient: async () => "test@example.invalid", pause: async () => {} });
    await worker.run(); assert.equal(job.deliveryState, "pending");
    now += 60000; await worker.run(); await worker.run();
    assert.equal(job.deliveryState, "accepted"); assert.equal(job.providerMessageId, "status-provider-id");
    assert.equal(requests.length, 2); assert.deepEqual(requests[0], requests[1]);
    assert.ok(requests[0].key.includes("isolated-status-event"));
    assert.equal(requests[0].payload.subject, "Your Pet Appointment Is Confirmed! | Charming Fur-fection");
    assert.deepEqual(requests[0].payload.to, ["test@example.invalid"]);
  } finally { global.fetch = originalFetch; Object.assign(env.mail, originalMail); Object.assign(env.runtime, originalRuntime); }
});

test("linked customers require the verified email of their actual Supabase identity", async () => {
  const filename = path.resolve(__dirname, "../src/services/appointmentStatusEmail.service.js");
  const loaded = new Module(filename); loaded.filename = filename; loaded.paths = Module._nodeModulePaths(path.dirname(filename));
  const original = loaded.require.bind(loaded);
  let identity = { email: "verified@example.invalid", email_confirmed_at: "2030-01-01T00:00:00Z" };
  loaded.require = name => name === "./supabaseAuth.service" ? { getSupabaseUserById: async id => { assert.equal(id, "trusted-auth-id"); return { user: identity }; } } : original(name);
  loaded._compile(fs.readFileSync(filename, "utf8"), filename);
  const db = { collection: () => ({ doc: id => { assert.equal(id, "trusted-customer-id"); return { get: async () => ({ data: () => ({ role: "customer", accountStatus: "active", email: "verified@example.invalid", authUserId: "trusted-auth-id" }) }) }; } }) };
  const resolve = () => loaded.exports.resolveCustomerRecipient(db, "trusted-customer-id");
  assert.equal(await resolve(), "verified@example.invalid");
  identity = { ...identity, email: "another@example.invalid" }; await assert.rejects(resolve(), { code: "RECIPIENT_UNVERIFIED" });
  identity = { email: "verified@example.invalid" }; await assert.rejects(resolve(), { code: "RECIPIENT_UNVERIFIED" });
});
