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

test("honors opt-in, terminal statuses, and reminder window", () => {
  const now = Date.parse("2026-10-20T00:00:00Z");
  assert.equal(isDue(appointment, now - 1), false);
  assert.equal(isDue(appointment, now), true);
  assert.equal(isDue(appointment, now + 3600000), false);
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
    if (attempts === 1) throw new Error("SMTP unavailable");
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
