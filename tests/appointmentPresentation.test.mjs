import assert from "node:assert/strict";
import test from "node:test";
import { filterAppointmentList, paginateAppointmentList, groupPendingAppointments, appointmentStatusLabel, appointmentStart, APPOINTMENT_COLORS } from "../src/app/utils/appointmentPresentation.js";

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
  assert.equal(APPOINTMENT_COLORS.Cancelled.background, APPOINTMENT_COLORS.Expired.background);
});
