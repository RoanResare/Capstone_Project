import assert from "node:assert/strict";
import test from "node:test";
import { getServiceUnavailableMessage, isServiceAvailableOnDate } from "../shared/serviceAvailability.mjs";
import { validateAppointmentServices } from "../shared/bookingServices.mjs";

test("weekday-restricted services are rejected by selected date while daily grooming remains available", () => {
  assert.equal(isServiceAvailableOnDate("vaccination", "2030-01-08"), false);
  assert.equal(isServiceAvailableOnDate("vaccination", "2030-01-05"), true);
  assert.equal(isServiceAvailableOnDate("pet-grooming", "2030-01-08"), true);
  assert.match(getServiceUnavailableMessage("vaccination", "2030-01-08"), /Vaccination is not available on weekdays/);
  assert.throws(() => validateAppointmentServices(["pet-grooming", "vaccination"], "2030-01-08"), /Vaccination is not available on weekdays/);
  assert.doesNotThrow(() => validateAppointmentServices(["pet-grooming", "vaccination"], "2030-01-05"));
  assert.equal(isServiceAvailableOnDate("vaccination", "2030-02-31"), false);
});
