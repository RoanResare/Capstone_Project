import { test } from "node:test";
import assert from "node:assert/strict";
import { buildAppointmentHistory } from "../shared/appointmentHistory.mjs";

test("admin and staff history includes only terminal appointment events in newest order", () => {
  const appointments = [
    { id: "pending", status: "Pending", petName: "Pending pet" },
    { id: "approved", status: "Confirmed" },
    { id: "completed", status: "Completed", petName: "Milo", updatedAt: "2030-01-02T12:00:00Z",
      lifecycleEvents: [{ status: "Completed", actorName: "Staff A", actorRole: "staff", createdAt: "2030-01-01T12:00:00Z" }] },
    { id: "cancelled", status: "Cancelled", updatedAt: "2030-01-03T12:00:00Z" },
    { id: "rejected", status: "Rejected", updatedAt: "2030-01-02T12:00:00Z", rejectionReason: "Unavailable" },
    { id: "no-show", status: "No-Show", updatedAt: "2030-01-04T12:00:00Z" },
  ];
  for (const role of ["admin", "staff"]) {
    const events = buildAppointmentHistory(appointments, role);
    assert.deepEqual(events.map(event => event.appointmentId), ["no-show", "cancelled", "rejected", "completed"]);
    assert.equal(events.at(-1).actorName, "Staff A");
    assert.equal(events[2].reason, "Unavailable");
    assert.equal(events.at(-1).createdAt, "2030-01-01T12:00:00Z");
  }
  assert.deepEqual(buildAppointmentHistory(appointments, "customer"), []);
});

test("previous lifecycle events survive a reopened appointment and legacy expired records appear as no-shows", () => {
  const events = buildAppointmentHistory([
    { id: "reopened", status: "Confirmed", lifecycleEvents: [
      { status: "Rejected", createdAt: "2030-01-01T12:00:00Z" },
      { status: "Pending", createdAt: "2030-01-02T12:00:00Z" },
      { status: "Cancelled", createdAt: "2030-01-03T12:00:00Z" },
    ] },
    { id: "old", status: "Expired", updatedAt: "2030-01-04T12:00:00Z" },
  ], "admin");
  assert.deepEqual(events.map(event => event.status), ["No Show", "Cancelled", "Rejected"]);
});
