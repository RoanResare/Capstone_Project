import assert from "node:assert/strict";
import test from "node:test";
import {
  canApproveAppointment,
  canCompleteAppointment,
  canChangeAppointmentStatus,
} from "../src/app/utils/appointmentActions.js";

test("only pending appointments can be approved", () => {
  assert.equal(canApproveAppointment("Pending"), true);
  for (const status of ["Accepted", "Approved", "Confirmed", "Completed", "Rejected", "Cancelled", "Expired"]) {
    assert.equal(canApproveAppointment(status), false, status);
  }
});

test("only pending and approved appointments can be completed", () => {
  for (const status of ["Pending", "Accepted", "Approved"]) {
    assert.equal(canCompleteAppointment(status), true, status);
  }
  for (const status of ["Confirmed", "Completed", "Rejected", "Cancelled", "Expired"]) {
    assert.equal(canCompleteAppointment(status), false, status);
  }
});

test("portal status actions cannot reject, cancel, or reopen appointments", () => {
  for (const status of ["Pending", "Accepted", "Approved", "Confirmed", "Completed", "Rejected", "Cancelled", "Expired"]) {
    for (const nextStatus of ["Rejected", "Cancelled", "Pending", "Confirmed"]) {
      assert.equal(canChangeAppointmentStatus(status, nextStatus), false, `${status} -> ${nextStatus}`);
    }
  }
  assert.equal(canChangeAppointmentStatus("Pending", "Accepted"), true);
  assert.equal(canChangeAppointmentStatus("Accepted", "Completed"), true);
  assert.equal(canChangeAppointmentStatus("Confirmed", "Completed"), false);
});
