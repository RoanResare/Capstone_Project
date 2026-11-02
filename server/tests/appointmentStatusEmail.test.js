const { test } = require("node:test");
const assert = require("node:assert/strict");
const { queueStatusEmail, createStatusEmailWorker, buildStatusEmail, resolveCustomerRecipient, TYPE } = require("../src/services/appointmentStatusEmail.service");

function fixture() {
  const records = new Map();
  const query = (name, filters = [], count = Infinity) => ({
    doc: id => ({ key: `${name}/${id}`, id }),
    where: (field, operator, value) => query(name, [...filters, { field, operator, value }], count),
    orderBy: () => query(name, filters, count), limit: value => query(name, filters, value),
    async get() { return { docs: [...records].filter(([key, data]) => key.startsWith(`${name}/`) && filters.every(({ field, operator, value }) => operator === "==" ? data[field] === value : data[field] <= value))
      .slice(0, count).map(([key, data]) => ({ id: key.split("/")[1], ref: { key }, data: () => data })) }; },
  });
  let transactionQueue = Promise.resolve();
  const db = { collection: name => {
    const value = query(name);
    const doc = value.doc;
    value.doc = id => ({ ...doc(id), get: async () => ({ data: () => records.get(`${name}/${id}`) }) });
    return value;
  }, runTransaction(action) {
    const run = transactionQueue.then(async () => {
      const writes = [];
      const result = await action({ get: async ref => ({ data: () => records.get(ref.key) }),
        set: (ref, data, options) => writes.push([ref.key, options?.merge ? { ...records.get(ref.key), ...data } : data]) });
      if (db.failCommit) throw new Error("Commit failed");
      for (const [key, data] of writes) records.set(key, data);
      return result;
    });
    transactionQueue = run.catch(() => {});
    return run;
  } };
  let now = 1793606400000;
  const sent = [];
  const workerOptions = { db, clock: () => now, resolveRecipient: async id => { assert.equal(id, "customer"); return "verified@example.invalid"; },
    makeEnvelope: (job, to) => ({ ...buildStatusEmail(job), to, messageId: `event-${job.eventId}` }),
    pause: async () => {}, send: async envelope => { sent.push(envelope); return { id: "provider-id" }; } };
  const queue = async (status = "Approved", overrides = {}) => db.runTransaction(transaction => queueStatusEmail({ db, transaction,
    previous: { status: "Pending", customerId: "customer" },
    appointment: { id: "appointment", status, petName: "Milo", service: "Consultation", scheduleDate: "2030-02-01", scheduleTime: "14:00", customerEmail: "attacker@example.invalid" }, actor: { uid: "staff", role: "staff" }, clock: () => now, ...overrides }));
  return { db, records, sent, queue, workerOptions, worker: createStatusEmailWorker(workerOptions), advance: value => { now += value; } };
}

for (const status of ["Approved", "Rejected", "Cancelled", "Accepted", "Confirmed"]) {
  test(`${status} queues a committed customer snapshot and sends one logical email`, async () => {
    const app = fixture(); await app.queue(status); await app.worker.run(); await app.worker.run();
    assert.equal(app.sent.length, 1);
    assert.equal(app.sent[0].to, "verified@example.invalid");
    const job = [...app.records.values()][0];
    assert.equal(job.deliveryState, "accepted"); assert.equal(job.attempts, 1); assert.equal(job.providerMessageId, "provider-id");
    assert.equal(job.customerEmail, undefined); assert.ok(job.eventId);
    assert.match(app.sent[0].text, /2:00 PM \(Philippine time, Asia\/Manila\)/);
    assert.match(app.sent[0].text, /February 1, 2030/);
    assert.equal(app.sent[0].text.includes("attacker"), false);
  });
}
test("queue creation rolls back with the appointment; no provider work occurs inside the transaction", async () => {
  const app = fixture(); app.db.failCommit = true;
  await assert.rejects(app.queue(), /Commit failed/);
  assert.equal(app.records.size, 0); assert.equal(app.sent.length, 0);
  app.db.failCommit = false; await app.worker.run(); assert.equal(app.sent.length, 0);
});
test("customer actions, unchanged approval aliases, new appointments and unrelated statuses never enqueue", async () => {
  const app = fixture();
  for (const overrides of [{ actor: { role: "customer" } }, { previous: null }, { previous: { status: "Accepted" } }]) await app.queue("Approved", overrides);
  await app.queue("Completed"); await app.queue("Pending");
  assert.equal(app.records.size, 0);
  await app.queue("Cancelled", { previous: { status: "Approved", customerId: "customer" } });
  assert.equal(app.records.size, 1);
});
test("retries freeze recipient and content, retain the event key and never change appointment state", async () => {
  const app = fixture(); await app.queue();
  const appointment = { status: "Approved" }; app.records.set("appointments/appointment", appointment);
  let attempts = 0; const payloads = [];
  const worker = createStatusEmailWorker({ ...app.workerOptions, send: async payload => {
    payloads.push(payload); if (++attempts === 1) throw Object.assign(new Error("private email details"), { code: "provider_unavailable" }); return { id: "retried" };
  } });
  await worker.run(); await worker.run(); assert.equal(attempts, 1);
  const entry = [...app.records.values()].find(value => value.notificationType === TYPE);
  assert.equal(entry.deliveryState, "pending"); assert.equal(entry.lastErrorCode, "provider_unavailable"); assert.ok(entry.failedAt);
  app.advance(60000); await worker.run(); await worker.run();
  assert.equal(attempts, 2); assert.deepEqual(payloads[0], payloads[1]); assert.equal(appointment.status, "Approved");
});
test("two worker instances share transactional leases and do not send twice", async () => {
  const app = fixture(); await app.queue();
  await Promise.all([app.worker.run(), createStatusEmailWorker(app.workerOptions).run()]);
  assert.equal(app.sent.length, 1);
});
test("unverified or changed recipients are skipped and never redirected to another address", async () => {
  for (const code of ["RECIPIENT_UNVERIFIED", "RECIPIENT_CHANGED", "RECIPIENT_MISSING"]) {
    const app = fixture(); await app.queue();
    const worker = createStatusEmailWorker({ ...app.workerOptions, resolveRecipient: async () => { throw Object.assign(new Error("ineligible"), { code }); } });
    await worker.run(); assert.equal(app.sent.length, 0); assert.equal([...app.records.values()][0].deliveryState, "skipped");
  }
});
test("expired provider deduplication windows require review rather than an automatic duplicate send", async () => {
  const app = fixture(); await app.queue();
  const worker = createStatusEmailWorker({ ...app.workerOptions, send: async () => { throw new Error("ambiguous provider timeout"); } });
  await worker.run(); app.advance(24 * 3600000); await app.worker.run();
  assert.equal(app.sent.length, 0); assert.equal([...app.records.values()][0].deliveryState, "needs_review");
});
test("templates escape customer-facing reasons, omit private notes, use official links and exact subjects", async () => {
  const app = fixture(); await app.queue("Rejected", { reason: '<img src=x onerror="bad()">', appointment: { id: "appointment", status: "Rejected", petName: "<Milo>", service: "Consultation", scheduleDate: "2030-01-31", scheduleTime: "09:00", notes: "private medical notes" } });
  const email = buildStatusEmail([...app.records.values()][0]);
  assert.equal(email.subject, "Update on Your Appointment Request | Charming Fur-fection");
  assert.match(email.html, /&lt;img/); assert.equal(email.html.includes("<img"), false);
  assert.equal(email.text.includes("private medical notes"), false); assert.match(email.text, /9:00 AM/);
});
test("recipient resolution uses trusted verified customer profiles and refuses staff, missing and invalid emails", async () => {
  const app = fixture();
  const ref = "users/customer";
  const valid = { role: "customer", accountStatus: "active", emailVerified: true, email: "VERIFIED@example.invalid" };
  app.records.set(ref, valid); assert.equal(await resolveCustomerRecipient(app.db, "customer"), "verified@example.invalid");
  for (const change of [{ role: "staff" }, { emailVerified: false }, { email: "invalid" }, { accountStatus: "inactive" }]) {
    app.records.set(ref, { ...valid, ...change }); await assert.rejects(resolveCustomerRecipient(app.db, "customer"));
  }
  app.records.delete(ref); await assert.rejects(resolveCustomerRecipient(app.db, "customer"));
});

test("crash after provider acceptance replays the frozen key and payload without another logical email", async () => {
  const app = fixture(); await app.queue();
  const accepted = new Map(), payloads = [];
  const send = async payload => {
    payloads.push(payload);
    if (!accepted.has(payload.messageId)) accepted.set(payload.messageId, { id: "provider-accepted-before-crash" });
    if (payloads.length === 1) app.db.failCommit = true;
    return accepted.get(payload.messageId);
  };
  const worker = createStatusEmailWorker({ ...app.workerOptions, send });
  const log = console.error; console.error = () => {};
  try { await worker.run(); } finally { console.error = log; }
  app.db.failCommit = false; app.advance(5 * 60000);
  await worker.run();
  assert.equal(accepted.size, 1); assert.equal(payloads.length, 2);
  assert.deepEqual(payloads[0], payloads[1]);
  assert.equal([...app.records.values()][0].deliveryState, "accepted");
});

test("bounded batches drain due jobs and empty/future queues do not schedule empty polling", async () => {
  const app = fixture();
  assert.equal(await app.worker.run(), Infinity);
  for (let index = 0; index < 15; index++) await app.queue();
  assert.ok(Number.isFinite(await app.worker.run())); assert.equal(app.sent.length, 10);
  assert.equal(await app.worker.run(), Infinity); assert.equal(app.sent.length, 15);
  const future = fixture();
  for (let index = 0; index < 10; index++) await future.queue();
  for (const record of future.records.values()) record.retryAt += 3600000;
  const deadline = [...future.records.values()][0].retryAt;
  assert.equal(await future.worker.run(), deadline); assert.equal(future.sent.length, 0);
});

test("missing and invalid legacy dates/times are never replaced with invented appointment details", () => {
  const email = buildStatusEmail({ status: "Cancelled", details: { scheduleDate: "2030-02-30", scheduleTime: "99:30 AM" } });
  assert.match(email.text, /2030-02-30/); assert.match(email.text, /99:30 AM/);
  assert.equal(email.text.includes("March"), false);
  assert.match(buildStatusEmail({ status: "Approved", details: {} }).text, /Not recorded/);
});
