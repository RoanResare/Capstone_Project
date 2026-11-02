const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const { createStatusEmailWorker, TYPE } = require("../src/services/appointmentStatusEmail.service");

function fixture(status = "Pending") {
  const initial = { id: "booking", customerId: "customer", status, petName: "Milo", service: "Consultation", serviceId: "consultation", scheduleDate: "2030-02-01", scheduleTime: "09:00" };
  const records = new Map([["appointments/booking", initial]]);
  const makeQuery = (name, filters = [], count = Infinity) => ({
    doc: id => ({ key: `${name}/${id}`, id }),
    where: (field, op, value) => makeQuery(name, [...filters, { field, op, value }], count),
    orderBy: () => makeQuery(name, filters, count), limit: value => makeQuery(name, filters, value),
    get: async () => get({ name, filters, count }), name, filters, count,
  });
  const get = async ref => ref.key ? { exists: records.has(ref.key), data: () => records.get(ref.key) }
    : { docs: [...records].filter(([key, data]) => key.startsWith(`${ref.name}/`) && ref.filters.every(({field,op,value}) => op === "==" ? data[field] === value : op === "in" ? value.includes(data[field]) : data[field] <= value))
      .slice(0, ref.count).map(([key, data]) => ({ id: key.split("/")[1], ref: { key }, data: () => data })) };
  let tail = Promise.resolve();
  const db = { collection: name => makeQuery(name), runTransaction: action => {
    const pending = tail.then(async () => {
      const writes = [];
      const result = await action({ get, set: (ref, data, options) => writes.push([ref.key, options?.merge ? { ...records.get(ref.key), ...data } : data]) });
      if (db.failCommit) throw new Error("commit failed");
      writes.forEach(([key, data]) => records.set(key, data));
      return result;
    });
    tail = pending.catch(() => {}); return pending;
  } };
  const load = name => {
    const filename = path.resolve(__dirname, "../src/controllers", name);
    const controller = new Module(filename); controller.filename = filename; controller.paths = Module._nodeModulePaths(path.dirname(filename));
    const original = controller.require.bind(controller);
    controller.require = name => name === "../config/postgresDatabase" ? { db } : original(name);
    controller._compile(fs.readFileSync(filename, "utf8"), filename);
    return controller.exports;
  };
  const { saveAppointment } = load("appointment.controller.js");
  const { disableAvailabilitySlot } = load("schedule.controller.js");
  const jobs = () => [...records.values()].filter(data => data.notificationType === TYPE);
  const save = async (updates, role = "staff") => {
    let response;
    await saveAppointment({ params: { id: "booking" }, body: { ...records.get("appointments/booking"), ...updates }, auth: { user: { uid: role === "customer" ? "customer" : "employee", role } } }, { json: value => { response = value; } });
    return response;
  };
  return { db, records, initial, save, jobs, closeSlot: async () => {
    let response;
    await disableAvailabilitySlot({ params: { id: "slot" }, auth: { user: { uid: "employee", role: "staff" } } }, { json: value => { response = value; } });
    return response;
  } };
}

for (const role of ["admin", "staff"]) {
  test(`${role} approval and duplicate requests create exactly one committed event`, async () => {
    const app = fixture();
    const first = await app.save({ status: "Approved" }, role);
    assert.equal(first.emailNotification.state, "pending");
    assert.equal(app.jobs().length, 1);
    await app.save({ status: "Approved" }, role); await app.save({ status: "Approved", notes: "internal only" }, role);
    assert.equal(app.jobs().length, 1); assert.equal(app.jobs()[0].details.notes, undefined);
  });
}
test("concurrent approval retries serialize with the appointment and create one event", async () => {
  const app = fixture();
  await Promise.all([app.save({ status: "Approved" }), app.save({ status: "Approved" })]);
  assert.equal(app.jobs().length, 1);
});
for (const [previous, status] of [["Pending", "Rejected"], ["Pending", "Cancelled"], ["Approved", "Cancelled"]]) {
  test(`${previous} -> ${status} uses the existing authorized decision reason`, async () => {
    const app = fixture(previous);
    await app.save({ status, decision: { category: "C", reason: "Clinic staffing is unavailable." } });
    assert.equal(app.jobs().length, 1); assert.equal(app.jobs()[0].details.reason, "Clinic staffing is unavailable.");
    assert.equal(app.records.get("appointments/booking").status, status);
    await assert.rejects(app.save({ status: "Approved" })); assert.equal(app.jobs().length, 1);
  });
}
test("invalid decisions, failed commits, and customer approvals cannot create email work", async () => {
  const app = fixture();
  await assert.rejects(app.save({ status: "Approved" }, "customer"));
  await assert.rejects(app.save({ status: "Rejected" }));
  assert.equal(app.jobs().length, 0);
  app.db.failCommit = true; await assert.rejects(app.save({ status: "Approved" }), /commit failed/);
  assert.equal(app.jobs().length, 0); assert.equal(app.records.get("appointments/booking").status, "Pending");
});
test("customer cancellation and unchanged reads/assignment edits never enqueue staff decision mail", async () => {
  const app = fixture(); await app.save({ notes: "internal only" });
  assert.equal(app.jobs().length, 0);
  await app.save({ status: "Cancelled" }, "customer"); assert.equal(app.jobs().length, 0);
});
test("email failure leaves the committed staff decision intact", async () => {
  const app = fixture(); await app.save({ status: "Approved", customerEmail: "wrong@example.invalid", customerId: "request-supplied-account" });
  const worker = createStatusEmailWorker({ db: app.db, pause: async () => {}, resolveRecipient: async id => { assert.equal(id, "customer"); return "correct@example.invalid"; }, makeEnvelope: (_job, to) => ({ to }), send: async () => { throw new Error("simulated outage"); } });
  await worker.run();
  assert.equal(app.records.get("appointments/booking").status, "Approved");
  assert.equal(app.jobs()[0].deliveryState, "pending"); assert.equal(app.jobs()[0].attempts, 1);
});
test("closing a slot atomically queues each actual cancellation and a repeated closure queues nothing", async () => {
  const app = fixture("Approved");
  app.records.set("availabilitySlots/slot", { id: "slot", date: "2030-02-01", time: "09:00", isOpen: true });
  app.records.get("appointments/booking").slotId = "slot";
  await app.closeSlot();
  assert.equal(app.records.get("appointments/booking").status, "Cancelled");
  assert.equal(app.jobs().length, 1); assert.match(app.jobs()[0].details.reason, /closed this date/);
  await app.closeSlot(); assert.equal(app.jobs().length, 1);
});
