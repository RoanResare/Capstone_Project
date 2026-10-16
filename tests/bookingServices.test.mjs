import assert from "node:assert/strict";
import test from "node:test";
import { validateServiceIds, validateAppointmentServices, validateSinglePet, getEstimatedDuration, appointmentsOverlap, canPairServices, getDefaultBlockCapacity, getBlockCapacity, matchesAppointmentBlock, getActiveAppointmentCountForSlot } from "../shared/bookingServices.mjs";
import { serviceCatalog } from "../src/app/data/systemData.js";

test("different service pairs respect the excluded combination and two-hour limit in either order", () => {
  for (const first of serviceCatalog) {
    assert.equal(getEstimatedDuration([first.id]), Number.parseInt(first.duration));
    for (const second of serviceCatalog) {
      if (first.id === second.id) assert.throws(() => validateServiceIds([first.id, second.id]), /same service/);
      else {
        const total = Number.parseInt(first.duration) + Number.parseInt(second.duration);
        assert.equal(getEstimatedDuration([first.id, second.id]), total);
        const excluded = [first.id, second.id].includes("laboratory-testing") && [first.id, second.id].includes("pet-grooming");
        assert.equal(canPairServices(first.id, second.id), !excluded && total <= 120);
        if (excluded || total > 120) assert.throws(() => validateAppointmentServices([first.id, second.id]));
        else validateAppointmentServices([first.id, second.id]);
      }
    }
  }
  for (const ids of [[], ["vaccination", "deworming", "consultation"], ["invalid"]]) assert.throws(() => validateServiceIds(ids));
});

test("morning and afternoon blocks retain capacities of three and two", () => {
  assert.equal(getDefaultBlockCapacity("09:00"), 3);
  assert.equal(getDefaultBlockCapacity("11:00"), 3);
  assert.equal(getDefaultBlockCapacity("14:00"), 2);
  assert.equal(getDefaultBlockCapacity("16:00"), 2);
  assert.equal(getBlockCapacity({ time: "09:00", capacity: 999 }), 3);
  assert.equal(getBlockCapacity({ time: "14:00", capacity: 999 }), 2);
  assert.equal(getBlockCapacity({ time: "09:00", capacity: 1 }), 1);
});

test("legacy slot IDs and matching dates and times identify the same block", () => {
  const slot = { id: "slot", date: "2030-01-05", time: "09:00" };
  assert.ok(matchesAppointmentBlock({ slotId: "slot" }, slot));
  assert.ok(matchesAppointmentBlock({ slotId: "alias", scheduleDate: slot.date, scheduleTime: "09:00" }, slot));
  assert.equal(matchesAppointmentBlock({ slotId: "other", scheduleDate: slot.date, scheduleTime: "11:00" }, slot), false);
});

test("Pending appointments occupy a slot and cancelled appointments release it", () => {
  const slot = { id: "slot", date: "2030-01-05", time: "09:00" };
  const appointment = { slotId: "slot", status: "Pending" };
  assert.equal(getActiveAppointmentCountForSlot([appointment], slot), 1);
  assert.equal(getActiveAppointmentCountForSlot([{...appointment,status:"Cancelled"}], slot), 0);
});

test("each grouped appointment has exactly one pet", () => {
  validateSinglePet({ petRecordId: "pet", petRecordIds: ["pet"], petSnapshots: [{ id: "pet" }] });
  assert.throws(() => validateSinglePet({}), /exactly one pet/);
  assert.throws(() => validateSinglePet({ petRecordId: "pet", petRecordIds: ["pet", "other"] }), /exactly one pet/);
  assert.throws(() => validateSinglePet({ petRecordId: "pet", petSnapshot: { id: "other" } }), /exactly one pet/);
});

test("paired service intervals detect conflicts and allow adjacent appointments", () => {
  const first = { serviceIds: ["vaccination", "deworming"], scheduleDate: "2030-01-05", scheduleTime: "09:00" };
  assert.ok(appointmentsOverlap(first, { serviceId: "vaccination", scheduleDate: "2030-01-05", scheduleTime: "10:00" }));
  assert.equal(appointmentsOverlap(first, { serviceId: "vaccination", scheduleDate: "2030-01-05", scheduleTime: "11:00" }), false);
  assert.equal(appointmentsOverlap(first, { serviceId: "vaccination", scheduleDate: "2030-01-06", scheduleTime: "09:00" }), false);
});
