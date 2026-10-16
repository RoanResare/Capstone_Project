import assert from "node:assert/strict";
import test from "node:test";
import {
  canApproveAppointment,
  canCompleteAppointment,
  canChangeAppointmentStatus,
} from "../src/app/utils/appointmentActions.js";

test("only pending appointments can be approved", () => {
  assert.equal(canApproveAppointment("Pending"), true);
  for (const status of ["Accepted", "Approved", "Confirmed", "Completed", "Rejected", "Cancelled", "No Show"]) {
    assert.equal(canApproveAppointment(status), false, status);
  }
});

test("only approved appointments and their legacy aliases can be completed", () => {
  for (const status of ["Accepted", "Approved", "Confirmed"]) {
    assert.equal(canCompleteAppointment(status), true, status);
  }
  for (const status of ["Pending", "Completed", "Rejected", "Cancelled", "No Show"]) {
    assert.equal(canCompleteAppointment(status), false, status);
  }
});

test("only pending appointments can be rejected or cancelled, and no appointment can be reopened", () => {
  for (const status of ["Pending", "Accepted", "Approved", "Confirmed", "Completed", "Rejected", "Cancelled", "No Show"]) {
    for (const nextStatus of ["Rejected", "Cancelled"]) {
      assert.equal(canChangeAppointmentStatus(status, nextStatus), status === "Pending", `${status} -> ${nextStatus}`);
    }
    for (const nextStatus of ["Pending", "Confirmed"]) {
      assert.equal(canChangeAppointmentStatus(status, nextStatus), false, `${status} -> ${nextStatus}`);
    }
  }
  assert.equal(canChangeAppointmentStatus("Pending", "Accepted"), true);
  assert.equal(canChangeAppointmentStatus("Accepted", "Completed"), true);
  assert.equal(canChangeAppointmentStatus("Confirmed", "Completed"), true);
});
