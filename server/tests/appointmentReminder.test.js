const { test } = require("node:test");
const assert = require("node:assert/strict");
const { reminderSchedule, isDue, createReminderWorker } = require("../src/services/appointmentReminder.service");
const appointment = { scheduleDate: "2026-10-20", scheduleTime: "09:00", reminderEnabled: true, status: "Approved", customerEmail: "customer@example.com" };

test("all four slots use clinic time and a one-hour lead", () => {
  for (const [slot, utcHour] of [["09:00", "00"], ["11:00", "02"], ["14:00", "05"], ["16:00", "07"]]) {
    assert.equal(new Date(reminderSchedule({ ...appointment, scheduleTime: slot }).dueAt).toISOString(), `2026-10-20T${utcHour}:00:00.000Z`);
  }
  assert.equal(reminderSchedule({ ...appointment, scheduleTime: "10:00" }), null);
  assert.equal(reminderSchedule({ ...appointment, scheduleDate: "2026-02-30" }), null);
});

test("honors opt-in, approved booking statuses, and reminder window", () => {
  const now = Date.parse("2026-10-20T00:00:00Z");
  assert.equal(isDue(appointment, now - 1), false);
  assert.equal(isDue(appointment, now), true);
  assert.equal(isDue(appointment, now + 3600000), false);
  for (const status of ["Approved", "Accepted", "Confirmed"]) {
    assert.equal(isDue({ ...appointment, status }, now), true);
    assert.equal(isDue({ ...appointment, status, reminderEnabled: false }, now), false);
  }
  for (const status of ["Pending", "pending"]) {
    assert.equal(isDue({ ...appointment, status }, now), false);
  }
  for (const override of [{ reminderEnabled: false }, { reminderEnabled: "true" }, { status: "Cancelled" }, { status: "Completed" }, { sessionStartedAt: "started" }, { customerEmail: "" }]) {
    assert.equal(isDue({ ...appointment, ...override }, now), false);
  }
});

test("persists delivery, retries failure, and leaves appointment status untouched", async () => {
  let now = Date.parse("2026-10-20T00:00:00Z");
  const records = new Map();
  const ref = { id: "booking" };
  const entry = { id: "booking", ref, data: () => appointment };
  const db = {
    collection: () => ({ where: () => ({ get: async () => ({ docs: [entry] }) }), doc: id => ({ id }) }),
    runTransaction: async fn => fn({
      get: async target => ({ exists: true, data: () => target === ref ? appointment : records.get(target.id) }),
      set: (target, value) => records.set(target.id, { ...records.get(target.id), ...value }),
    }),
  };
  let attempts = 0;
  const worker = createReminderWorker({ db, clock: () => now, sendReminder: async () => {
    attempts++;
    if (attempts === 1) throw new Error("Resend unavailable");
    return { messageId: "sent" };
  } });
  await worker.run();
  await worker.run();
  assert.equal(attempts, 1);
  now += 60000;
  await worker.run();
  await worker.run();
  assert.equal(attempts, 2);
  assert.equal(appointment.status, "Approved");
  assert.ok([...records.values()][0].sentAt);
});

test("queries clinic date, isolates claim failures, and never marks missing delivery IDs sent", async () => {
  const now = Date.parse("2026-10-20T00:00:00Z");
  const records = new Map();
  const entries = ["broken", "missing-id", "healthy"].map(id => ({ id, ref: { id }, data: () => appointment }));
  const db = {
    collection(name) { return {
      where(field, op, value) {
        assert.equal(name, "appointments"); assert.equal(field, "scheduleDate");
        assert.equal(op, "=="); assert.equal(value, "2026-10-20");
        return { get: async () => ({ docs: entries }) };
      }, doc: id => ({ id }),
    }; },
    runTransaction: async fn => fn({
      get: async ref => {
        if (ref === entries[0].ref) throw new Error("claim failed");
        return { exists: true, data: () => entries.some(entry => entry.ref === ref) ? appointment : records.get(ref.id) };
      },
      set: (ref, value) => records.set(ref.id, { ...records.get(ref.id), ...value }),
    }),
  };
  const sent = [];
  const worker = createReminderWorker({ db, clock: () => now, sendReminder: async (_, id) => {
    sent.push(id); return id.startsWith("missing-id") ? {} : { messageId: "provider-id" };
  } });
  await worker.run();
  assert.equal(sent.length, 2);
  const missing = records.get("missing-id-2026-10-20-0900");
  assert.equal(missing.sentAt, undefined);
  assert.equal(missing.lastErrorCode, "MISSING_DELIVERY_ID");
  assert.equal(missing.retryAt, now + 60000);
  assert.equal(records.get("healthy-2026-10-20-0900").messageId, "provider-id");
});
