const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const { test } = require("node:test");

function loadNoShowService(records) {
  const notifications = new Map();
  const rows = new Map(Object.entries(records));
  const matches = (record, { field, operator, value }) => {
    if (operator === "in") return value.includes(record[field]);
    if (operator === "<") return record[field] < value;
    if (operator === "<=") return record[field] <= value;
    return record[field] === value;
  };
  const queryFor = (collection, filters = [], ordered = "", max = Infinity, after = "") => ({
    where: (field, operator, value) => queryFor(collection, [...filters, { field, operator, value }], ordered, max, after),
    orderBy: (field) => queryFor(collection, filters, field, max, after),
    limit: (value) => queryFor(collection, filters, ordered, value, after),
    startAfter: (entry) => queryFor(collection, filters, ordered, max, entry.id),
    get: async () => {
      let docs = [...rows].filter(([, record]) => filters.every((filter) => matches(record, filter)))
        .map(([id, record]) => ({ id, ref: { collection, id }, data: () => record }));
      if (ordered) docs.sort((left, right) => String(left.data()[ordered]).localeCompare(String(right.data()[ordered])));
      if (after) docs = docs.slice(docs.findIndex((entry) => entry.id === after) + 1);
      docs = docs.slice(0, max);
      return { docs, empty: docs.length === 0, size: docs.length };
    },
  });
  const db = {
    collection: (collection) => ({
      doc: (id) => ({ collection, id }),
      where: (field, operator, value) => queryFor(collection).where(field, operator, value),
    }),
    runTransaction: async (callback) => callback({
      get: async (reference) => ({ exists: rows.has(reference.id), data: () => rows.get(reference.id) }),
      update: (reference, changes) => rows.set(reference.id, { ...rows.get(reference.id), ...changes }),
      set: (reference, value, options = {}) => {
        const target = reference.collection === "notifications" ? notifications : rows;
        target.set(reference.id, options.merge ? { ...target.get(reference.id), ...value } : value);
      },
    }),
  };
  const filename = path.resolve(__dirname, "../src/services/appointmentNoShow.service.js");
  const service = new Module(filename);
  service.filename = filename;
  service.paths = Module._nodeModulePaths(path.dirname(filename));
  const originalRequire = service.require.bind(service);
  service.require = (specifier) => specifier === "../config/postgresDatabase" ? { db } : originalRequire(specifier);
  service._compile(fs.readFileSync(filename, "utf8"), filename);
  return { service: service.exports, rows, notifications };
}

test("No Show waits until the scheduled calendar day has passed in Manila time", () => {
  const { clinicDate, hasAppointmentDayPassed } = loadNoShowService(new Map()).service;
  const appointment = { scheduleDate: "2026-11-15", scheduleTime: "09:00" };
  const appointmentEvening = new Date("2026-11-15T12:00:00Z");
  const nextManilaDay = new Date("2026-11-15T16:00:00Z");
  assert.equal(clinicDate(appointmentEvening), "2026-11-15");
  assert.equal(hasAppointmentDayPassed(appointment, clinicDate(appointmentEvening)), false);
  assert.equal(clinicDate(nextManilaDay), "2026-11-16");
  assert.equal(hasAppointmentDayPassed(appointment, clinicDate(nextManilaDay)), true);
  assert.equal(hasAppointmentDayPassed({ scheduleDate: "2026-02-30" }, "2026-03-01"), false);
});

test("automatic No Show protects same-day, attended, completed, cancelled, and rejected appointments without duplicating audit events", async () => {
  const { service, rows, notifications } = loadNoShowService({
    "past-pending": { status: "Pending", scheduleDate: "2026-11-15", scheduleTime: "09:00", customerId: "cust", customerEmail: "c@example.com" },
    "today-confirmed": { status: "Confirmed", scheduleDate: "2026-11-16", scheduleTime: "09:00", customerId: "cust", customerEmail: "c@example.com" },
    "attended": { status: "Accepted", scheduleDate: "2026-11-15", scheduleTime: "09:00", sessionStartedAt: "2026-11-15T01:00:00Z" },
    "completed": { status: "Completed", scheduleDate: "2026-11-15", scheduleTime: "09:00" },
    "cancelled": { status: "Cancelled", scheduleDate: "2026-11-15", scheduleTime: "09:00" },
    "rejected": { status: "Rejected", scheduleDate: "2026-11-15", scheduleTime: "09:00" },
  });
  const now = new Date("2026-11-16T02:00:00Z");
  assert.equal(await service.markPastAppointmentsNoShow(now), 1);
  assert.equal(rows.get("past-pending").status, "No Show");
  assert.deepEqual(rows.get("past-pending").lifecycleEvents[0], {
    status: "No Show", action: "Appointment marked No Show", changedFields: ["status"],
    actorId: "system", actorName: "Automatic appointment monitor", actorRole: "system", createdAt: now.toISOString(),
  });
  for (const [id, status] of [["today-confirmed", "Confirmed"], ["attended", "Accepted"], ["completed", "Completed"], ["cancelled", "Cancelled"], ["rejected", "Rejected"]]) {
    assert.equal(rows.get(id).status, status);
  }
  assert.equal(notifications.size, 1);
  assert.equal(await service.markPastAppointmentsNoShow(now), 0);
  assert.equal(rows.get("past-pending").lifecycleEvents.length, 1);
  assert.equal(notifications.size, 1);
});
