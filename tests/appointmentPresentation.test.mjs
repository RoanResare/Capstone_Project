import assert from "node:assert/strict";
import test from "node:test";
import { APPOINTMENT_STATUSES, filterAppointmentList, paginateAppointmentList, groupPendingAppointments, appointmentStatusLabel, appointmentStart, compareAppointmentSchedule, compareAppointmentCreatedNewest, getCustomerAppointmentStats, findNearestUpcomingAppointment, APPOINTMENT_COLORS } from "../src/app/utils/appointmentPresentation.js";

test("customer pagination returns three appointments without losing the rest", () => {
  const records = Array.from({ length: 7 }, (_, index) => ({ id: String(index) }));
  assert.equal(paginateAppointmentList(records, 0).appointments.length, 3);
  assert.deepEqual(paginateAppointmentList(records, 1).appointments.map((record) => record.id), ["3", "4", "5"]);
  assert.deepEqual(paginateAppointmentList(records, 2).appointments.map((record) => record.id), ["6"]);
  assert.equal(paginateAppointmentList(records, 9).page, 2);
  assert.equal(paginateAppointmentList([], 0).pageCount, 1);
});

test("status and text filtering includes approved aliases and combines both filters", () => {
  const records = [{ id: "a", status: "Pending", petName: "Snow", service: "Grooming" },
    { id: "b", status: "Confirmed", petName: "Snow", service: "Vaccination" },
    { id: "c", status: "Accepted", petName: "Fall", service: "Laboratory Testing" }];
  assert.deepEqual(filterAppointmentList(records, "Approved", "snow").map((record) => record.id), ["b"]);
  assert.equal(filterAppointmentList(records, "Rejected", "").length, 0);
  assert.equal(appointmentStatusLabel("Confirmed"), "Approved");
});

test("pending groups are ordered by scheduled date and time rather than creation time", () => {
  const groups = groupPendingAppointments([
    { id: "later", scheduleDate: "2030-01-17", scheduleTime: "09:00" },
    { id: "afternoon", scheduleDate: "2030-01-13", scheduleTime: "14:00" },
    { id: "morning", scheduleDate: "2030-01-13", scheduleTime: "09:00" },
  ]);
  assert.deepEqual(groups.map((group) => group.date), ["2030-01-13", "2030-01-17"]);
  assert.deepEqual(groups[0].appointments.map((record) => record.id), ["morning", "afternoon"]);
  assert.equal(appointmentStart({ schedule: "2030-01-12T01:00:00Z" }), "2030-01-12T09:00:00");
  assert.equal(appointmentStart({ scheduleDate: "2030-01-12", scheduleTime: "99:99" }), "");
});

test("calendar statuses follow amber, green, dark-green and red color groups", () => {
  assert.equal(APPOINTMENT_COLORS.Completed.background, "#165B3B");
  assert.notEqual(APPOINTMENT_COLORS.Approved.background, APPOINTMENT_COLORS.Pending.background);
  assert.equal(APPOINTMENT_COLORS.Rejected.background, APPOINTMENT_COLORS.Cancelled.background);
  assert.notEqual(APPOINTMENT_COLORS.Cancelled.background, APPOINTMENT_COLORS["No Show"].background);
  assert.equal(APPOINTMENT_COLORS["No Show"].border, "#9CA3AF");
});

test("schedule comparator sorts by scheduled date and time", () => {
  const records = [
    { id: "last", scheduleDate: "2030-10-17", scheduleTime: "09:00" },
    { id: "afternoon", scheduleDate: "2030-10-13", scheduleTime: "14:00" },
    { id: "morning", scheduleDate: "2030-10-13", scheduleTime: "09:00" },
    { id: "middle", scheduleDate: "2030-10-14", scheduleTime: "11:00" },
    { id: "unscheduled" },
  ];
  assert.deepEqual(records.sort(compareAppointmentSchedule).map((record) => record.id), ["morning", "afternoon", "middle", "last", "unscheduled"]);
});

test("customer appointment ordering stays newest-first across All, status, and search filters", () => {
  const records = [
    { id: "older-pending", status: "Pending", petName: "Milo", createdAt: "2026-11-12T10:00:00+08:00", scheduleDate: "2027-02-01" },
    { id: "newest-approved", status: "Approved", petName: "Luna", created_at: "2026-11-15T20:00:00+08:00", scheduleDate: "2026-11-20" },
    { id: "middle-pending", status: "Pending", petName: "Milo", createdAt: "2026-11-14T15:00:00+08:00", scheduleDate: "2026-11-16" },
    { id: "missing-time", status: "Cancelled", petName: "Nori" },
  ];
  const newestFirst = records.slice().sort(compareAppointmentCreatedNewest);

  assert.deepEqual(newestFirst.map((record) => record.id), ["newest-approved", "middle-pending", "older-pending", "missing-time"]);
  for (const status of ["All", ...APPOINTMENT_STATUSES]) {
    const result = filterAppointmentList(newestFirst, status);
    assert.deepEqual(result.map((record) => record.id), newestFirst
      .filter((record) => status === "All" || appointmentStatusLabel(record.status) === status)
      .map((record) => record.id));
  }
  assert.deepEqual(filterAppointmentList(newestFirst, "All", "milo").map((record) => record.id), ["middle-pending", "older-pending"]);
  assert.deepEqual(paginateAppointmentList(newestFirst, 0, 2).appointments.map((record) => record.id), ["newest-approved", "middle-pending"]);
  assert.deepEqual(paginateAppointmentList(newestFirst, 1, 2).appointments.map((record) => record.id), ["older-pending", "missing-time"]);
});

test("customer dashboard counts owned records by existing statuses and finds nearest eligible booking", () => {
  const appointments = [
    { id: "pending-later", status: "Pending", scheduleDate: "2026-11-20", scheduleTime: "09:00" },
    { id: "confirmed-nearest", status: "Confirmed", scheduleDate: "2026-11-18", scheduleTime: "14:00" },
    { id: "approved-later", status: "Approved", scheduleDate: "2026-11-19", scheduleTime: "09:00" },
    { id: "completed", status: "Completed", scheduleDate: "2026-11-17", scheduleTime: "12:00" },
    { id: "cancelled", status: "Cancelled", scheduleDate: "2026-11-17", scheduleTime: "10:00" },
    { id: "past", status: "Pending", scheduleDate: "2026-11-16", scheduleTime: "10:00" },
  ];
  assert.deepEqual(getCustomerAppointmentStats(appointments), { total: 6, pending: 2, confirmed: 2, completed: 1 });
  const nearest = findNearestUpcomingAppointment(appointments, Date.parse("2026-11-17T00:00:00+08:00"));
  assert.equal(nearest.appointment.id, "confirmed-nearest");
  assert.equal(nearest.startsAt.toISOString(), "2026-11-18T06:00:00.000Z");
  assert.equal(findNearestUpcomingAppointment([], Date.now()), null);
});
