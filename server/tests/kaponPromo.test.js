const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { test } = require("node:test");
const { ApiError } = require("../src/utils/ApiError");

function fixture(initial = {}) {
  const records = new Map([["pets/pet", { customerId: "customer", petType: "Cat", weightKg: "6" }], ...Object.entries(initial)]);
  const writes = [];
  const makeQuery = (name, filters = [], maxResults = Infinity) => ({
    query: true,
    name,
    filters,
    maxResults,
    limit: (nextLimit) => makeQuery(name, filters, nextLimit),
    where: (field, operator, value) => makeQuery(name, [...filters, { field, operator, value }], maxResults),
  });
  const matchesQuery = (data, filters) => filters.every(({ field, operator, value }) => {
    if (operator === "==") return data[field] === value;
    if (operator === "in") return Array.isArray(value) && value.includes(data[field]);
    return false;
  });
  const db = {
    collection: (name) => ({
      doc: (id) => ({ key: `${name}/${id}` }),
      where: (field, operator, value) => makeQuery(name, [{ field, operator, value }]),
    }),
    runTransaction: async (action) => {
      const pending = [];
      const result = await action({
        get: async (ref) => ref.query ? { docs: [...records]
          .filter(([key, data]) => key.startsWith(`${ref.name}/`) && matchesQuery(data, ref.filters))
          .slice(0, ref.maxResults)
          .map(([key, data]) => ({ id: key.split("/").at(-1), data: () => data })) } : { exists: records.has(ref.key), data: () => records.get(ref.key) },
        set: (ref, data, options) => pending.push({ ref, data, options }),
        delete: (ref) => pending.push({ ref, remove: true }),
      });
      for (const { ref, data, options, remove } of pending) {
        if (remove) { records.delete(ref.key); writes.push(ref.key); continue; }
        records.set(ref.key, options?.merge ? { ...records.get(ref.key), ...data } : data);
        writes.push(ref.key);
      }
      return result;
    },
  };
  const load = (name) => {
    const filename = path.join(__dirname, "../src/controllers", name);
    const context = { module: { exports: {} }, require: (id) => {
      if (id === "../config/firebaseAdmin") return { db };
      if (id === "../utils/ApiError") return { ApiError };
      throw new Error(`Unexpected dependency ${id}`);
    } };
    vm.runInNewContext(fs.readFileSync(filename, "utf8"), context, {
      filename, importModuleDynamically: vm.constants.USE_MAIN_CONTEXT_DEFAULT_LOADER,
    });
    return context.module.exports;
  };
  const promoController = load("promo.controller.js");
  const bookingController = load("appointment.controller.js");
  const petController = load("pet.controller.js");
  return { records, writes,
    deletePet: (uid = "customer", role = "customer") => petController.deletePet({ params: { id: "pet" }, auth: { user: { uid, role } } }, { json() {} }),
    promo: (body, role = "admin", extra = {}) => promoController.saveKaponPromo({ body, auth: { user: { uid: "employee", name: "Staff", role, accountStatus: "active", ...extra } } }, { json() {} }),
    book: (body, role = "customer") => {
      const appointment = { id: "booking", customerId: "customer", status: "Pending", serviceId: "low-cost-kapon", scheduleDate: "2030-01-05", scheduleTime: "09:00", petRecordId: "pet", ...body };
      appointment.serviceIds ||= [appointment.serviceId];
      appointment.clinicalSelections ||= [
        {category:"consultation",serviceId:"consultation"},
        {category:"vaccination",serviceId:"anti-rabies"},
        {category:"laboratory-testing",serviceId:"cbc-plain"},
      ];
      return bookingController.saveAppointment({ params: { id: "booking" }, auth: { user: { uid: "customer", role } }, body: appointment }, { json() {} });
    },
  };
}
const config = { formLink: "https://forms.gle/example123", title: "Low-Cost Kapon", description: "Limited slots" };

test("grooming pricing uses the saved pet weight and rejects invalid grooming types", async () => {
  const system = fixture({ "pets/pet": { customerId: "customer", petType: "Dog", weightKg: "6" } });
  await system.book({ serviceId: "pet-grooming", serviceIds: ["pet-grooming"], petRecordId: "pet", grooming: { serviceId: "basic", size: "X-Large", price: 1 } });
  const saved = system.records.get("appointments/booking");
  assert.equal(saved.grooming.size, "Small");
  assert.equal(saved.grooming.price, 300);
  assert.equal(saved.servicePrice, "PHP 300");
  await assert.rejects(system.book({ ...saved, grooming: { serviceId: "feline-basic" } }), /selected pet type/);
});

test("deleting a pet removes its pending and approved reservations and frees the slot", async () => {
  const system = fixture({
    "pets/pet": { customerId: "customer", petName: "Pet" },
    ...Object.fromEntries(["Pending", "Approved", "Accepted", "Confirmed", "Completed", "Rejected", "Cancelled"].map((status) => [`appointments/${status}`, { petRecordId: "pet", status, slotId: "block", scheduleDate: "2030-01-05", scheduleTime: "09:00" }])),
    "appointments/other": { petRecordId: "other", status: "Pending", slotId: "other-block" },
    "availabilitySlots/block": { capacity: 1, time: "09:00", date: "2030-01-05", isOpen: true },
  });
  await system.deletePet();
  assert.equal(system.records.has("pets/pet"), false);
  for (const status of ["Pending", "Approved", "Accepted", "Confirmed"]) assert.equal(system.records.has(`appointments/${status}`), false);
  for (const status of ["Completed", "Rejected", "Cancelled"]) assert.equal(system.records.has(`appointments/${status}`), true);
  assert.equal(system.records.has("appointments/other"), true);
  await assert.rejects(system.book({ serviceId: "consultation", petRecordId: "pet", slotId: "block" }), /pet profile was deleted/);
  system.records.set("pets/new-pet", { customerId: "customer", petType: "Cat" });
  await system.book({ serviceId: "consultation", petRecordId: "new-pet", slotId: "block" });
});

test("another customer cannot delete a pet or its reservations", async () => {
  const system = fixture({ "pets/pet": { customerId: "customer" }, "appointments/pending": { petRecordId: "pet", status: "Pending" } });
  await assert.rejects(system.deletePet("other-customer"), /only delete your own/);
  assert.equal(system.records.has("pets/pet"), true);
  assert.equal(system.records.has("appointments/pending"), true);
  assert.equal(system.writes.length, 0);
});

test("approval retains the reservation for its date and time block", async () => {
  const slot = { date: "2030-01-05", time: "09:00", capacity: 1, isOpen: true };
  const booking = { id: "booking", customerId: "customer", status: "Pending", serviceId: "consultation", slotId: "block", scheduleDate: slot.date, scheduleTime: slot.time };
  const system = fixture({ "appointments/booking": booking, "availabilitySlots/block": slot });
  await system.book({ ...booking, status: "Accepted", assignedStaff: "Staff" }, "admin");
  const approved = system.records.get("appointments/booking");
  assert.equal(approved.slotId, "block");
  assert.equal(approved.status, "Accepted");
  const next = fixture({ "appointments/reserved": { ...approved, id: "reserved" }, "availabilitySlots/block": slot });
  await assert.rejects(next.book({ serviceId: "consultation", slotId: "block" }), /already full/);
  await next.book({ serviceId: "consultation", slotId: "different-block", scheduleTime: "11:00" });
});

test("different bookings for the same customer, pet, and slot each reserve capacity", async () => {
  const slot = { date: "2030-01-05", time: "09:00", capacity: 3, isOpen: true };
  const existingBookings = Object.fromEntries([1, 2].map((index) => [`appointments/booking-${index}`, {
    id: `booking-${index}`, customerId: "customer", petRecordId: "pet", status: "Pending",
    slotId: "block", scheduleDate: slot.date, scheduleTime: slot.time,
    createdAt: `2030-01-0${index}T00:00:00.000Z`,
  }]));
  const app = fixture({ "pets/pet": { customerId: "customer", petType: "Cat" }, "availabilitySlots/block": slot, ...existingBookings });
  await app.book({ serviceId: "vaccination", serviceIds: ["vaccination"], petRecordId: "pet", slotId: "block",
    scheduleDate: slot.date, scheduleTime: slot.time,
    clinicalSelections: [{category:"vaccination",serviceId:"4-in-1"},{category:"vaccination",serviceId:"doctors-fee"}] });
  assert.equal(app.records.get("appointments/booking").status, "Pending");

  const cancellationWins = fixture({ "pets/pet": { customerId: "customer", petType: "Cat" }, "availabilitySlots/block": slot,
    "appointments/older-pending": { id:"older-pending", customerId:"customer", petRecordId:"pet", status:"Pending", slotId:"block", scheduleDate:slot.date, scheduleTime:slot.time, createdAt:"2030-01-01T00:00:00.000Z" },
    "appointments/newer-cancelled": { id:"newer-cancelled", customerId:"customer", petRecordId:"pet", status:"Cancelled", slotId:"block", scheduleDate:slot.date, scheduleTime:slot.time, createdAt:"2030-01-02T00:00:00.000Z" },
  });
  await cancellationWins.book({ serviceId: "vaccination", serviceIds: ["vaccination"], petRecordId: "pet", slotId: "block",
    scheduleDate: slot.date, scheduleTime: slot.time,
    clinicalSelections: [{category:"vaccination",serviceId:"4-in-1"},{category:"vaccination",serviceId:"doctors-fee"}] });
  assert.equal(cancellationWins.records.get("appointments/booking").status, "Pending");
});

test("staff sessions start once on the clinic date and end with persisted duration", async () => {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const booking = { id: "booking", customerId: "customer", status: "Approved", serviceId: "consultation", scheduleDate: today, scheduleTime: "09:00" };
  const system = fixture({ "appointments/booking": booking });
  await system.book({ ...booking, sessionAction: "start" }, "staff");
  const started = system.records.get("appointments/booking");
  assert.ok(started.sessionStartedAt);
  assert.equal(started.status, "Approved");
  await assert.rejects(system.book({ ...started, sessionAction: "start" }, "staff"), /only once/);
  await assert.rejects(system.book({ ...started, sessionAction: "end" }, "customer"));
  await system.book({ ...started, sessionAction: "end" }, "staff");
  const ended = system.records.get("appointments/booking");
  assert.equal(ended.status, "Completed");
  assert.ok(ended.sessionDurationSeconds >= 0);
  assert.ok(ended.sessionEndedAt);
  assert.equal(ended.sessionAction, undefined);
  const future = fixture({ "appointments/booking": { ...booking, scheduleDate: "2030-01-05" } });
  await assert.rejects(future.book({ ...booking, scheduleDate: "2030-01-05", sessionAction: "start" }, "staff"), /appointment date/);
});

test("admin and staff can activate, edit and deactivate a single promo while retaining private metadata", async () => {
  for (const role of ["admin", "staff"]) {
    const app = fixture();
    await app.promo({ ...config, action: "activate", expectedRevision: 0 }, role);
    assert.equal(app.records.get("lowCostKaponPromo/low-cost-kapon").isActive, true);
    assert.equal(app.records.get("promotionDetails/low-cost-kapon").activatedBy.uid, "employee");
    await app.promo({ ...config, formLink: "https://forms.gle/updated123", action: "edit", expectedRevision: 1 }, role);
    assert.equal(app.records.get("lowCostKaponPromo/low-cost-kapon").formLink, "https://forms.gle/updated123");
    assert.equal(app.records.get("lowCostKaponPromo/low-cost-kapon").isActive, true);
    await app.promo({ action: "deactivate", expectedRevision: 2 }, role);
    assert.equal(app.records.get("lowCostKaponPromo/low-cost-kapon").isActive, false);
    assert.equal(app.records.get("lowCostKaponPromo/low-cost-kapon").formLink, undefined);
    assert.equal(app.records.get("promotionDetails/low-cost-kapon").formLink, "https://forms.gle/updated123");
  }
});

test("customers, inactive staff, invalid links and stale edits cannot modify promotions", async () => {
  const app = fixture();
  await assert.rejects(app.promo({ ...config, action: "activate", expectedRevision: 0 }, "customer"), { statusCode: 403 });
  await assert.rejects(app.promo({ ...config, action: "activate", expectedRevision: 0 }, "staff", { accountStatus: "inactive" }), { statusCode: 403 });
  await assert.rejects(app.promo({ ...config, formLink: "https://evil.example/form", action: "activate", expectedRevision: 0 }), { statusCode: 400 });
  assert.equal(app.writes.length, 0);
  await app.promo({ ...config, action: "activate", expectedRevision: 0 });
  await assert.rejects(app.promo({ ...config, action: "edit", expectedRevision: 0 }), { statusCode: 409 });
  assert.equal(app.records.get("lowCostKaponPromo/low-cost-kapon").revision, 1);
});

test("booking backend rejects missing, inactive and expired kapon promos, even with manipulated names", async () => {
  for (const promo of [undefined, { isActive: false }, { ...config, isActive: true, endsAt: "2000-01-01T00:00:00Z" }]) {
    const app = fixture(promo ? { "lowCostKaponPromo/low-cost-kapon": promo } : {});
    await assert.rejects(app.book({}), { statusCode: 409 });
    await assert.rejects(app.book({ serviceId: "vaccination", service: "Low Cost Kapon" }), { statusCode: 409 });
    assert.equal(app.writes.length, 0);
    await app.book({ serviceId: "vaccination", service: "Vaccination" });
    assert.equal(app.writes.length, 1);
  }
  const app = fixture({ "lowCostKaponPromo/low-cost-kapon": { ...config, isActive: true } });
  await app.book({});
  assert.equal(app.writes.length, 1);
});

test("deactivation blocks new kapon bookings and rescheduling but allows existing cancellations", async () => {
  const app = fixture({ "lowCostKaponPromo/low-cost-kapon": { ...config, isActive: true, revision: 1 } });
  await app.book({ slotId: "original" });
  await app.promo({ action: "deactivate", expectedRevision: 1 });
  await assert.rejects(app.book({ slotId: "changed" }), { statusCode: 409 });
  await app.book({ status: "Cancelled", slotId: "original" });
  assert.equal(app.records.get("appointments/booking").status, "Cancelled");
});

test("paired services create one appointment with a server-calculated duration", async () => {
  const app = fixture();
  await app.book({ serviceId: "vaccination", serviceIds: ["vaccination", "deworming"], petRecordId: "pet", estimatedDurationMinutes: 1 });
  assert.equal(app.writes.length, 1);
  assert.equal(app.records.get("appointments/booking").estimatedDurationMinutes, 50);
  assert.equal(app.records.get("appointments/booking").blockDurationMinutes, 120);
  for (const body of [
    { serviceIds: ["vaccination", "vaccination"] },
    { serviceIds: ["vaccination", "deworming", "consultation"] },
    { serviceIds: ["vaccination", "invalid"] },
    { serviceId: "laboratory-testing", serviceIds: ["laboratory-testing", "pet-grooming"] },
    { serviceId: "pet-grooming", serviceIds: ["pet-grooming", "laboratory-testing"] },
    { serviceId: "low-cost-kapon", serviceIds: ["low-cost-kapon", "laboratory-testing"], estimatedDurationMinutes: 1 },
    { serviceId: "low-cost-kapon", serviceIds: ["low-cost-kapon", "consultation"], blockDurationMinutes: 999 },
    { petRecordIds: ["pet", "other"] },
  ]) {
    const blocked = fixture();
    await assert.rejects(blocked.book({ serviceId: "vaccination", serviceIds: ["vaccination", "deworming"], petRecordId: "pet", ...body }), { statusCode: 400 });
    assert.equal(blocked.writes.length, 0);
  }
});

test("a kapon secondary service still requires an active promotion", async () => {
  const app = fixture();
  await assert.rejects(app.book({ serviceId: "vaccination", serviceIds: ["vaccination", "low-cost-kapon"], petRecordId: "pet" }), { statusCode: 409 });
  assert.equal(app.writes.length, 0);
});

test("staff assignments reject overlapping durations but allow adjacent or different-staff appointments", async () => {
  const initial = { "appointments/other": { status: "Accepted", assignedStaff: "Staff A", serviceIds: ["vaccination", "deworming"], scheduleDate: "2030-01-05", scheduleTime: "09:00" } };
  for (const role of ["admin", "staff"]) {
    const app = fixture(initial);
    const body = { serviceId: "consultation", serviceIds: ["consultation"], petRecordId: "pet", assignedStaff: "Staff A", scheduleDate: "2030-01-05", scheduleTime: "09:00" };
    await assert.rejects(app.book(body, role), { statusCode: 409 });
    assert.equal(app.writes.length, 0);
    await app.book({ ...body, scheduleTime: "11:00" }, role);
    assert.equal(app.writes.length, 1);
    const different = fixture(initial);
    await different.book({ ...body, assignedStaff: "Staff B" }, role);
    assert.equal(different.writes.length, 1);
  }
});

test("fixed block capacity cannot be increased by a forged slot ID or submitted capacity", async () => {
  for (const [time, capacity] of [["09:00", 3], ["11:00", 3], ["14:00", 2], ["16:00", 2]]) {
    const occupied = Object.fromEntries(Array.from({ length: capacity }, (_, index) => [`appointments/other-${index}`, {
      status: "Pending", slotId: `different-${index}`, scheduleDate: "2030-01-05", scheduleTime: time,
    }]));
    const body = { serviceId: "vaccination", serviceIds: ["vaccination"], petRecordId: "pet", slotId: "forged", slotCapacity: 999, scheduleTime: time };
    const full = fixture(occupied);
    await assert.rejects(full.book(body), { statusCode: 409 });
    assert.equal(full.writes.length, 0);
    delete occupied[`appointments/other-${capacity - 1}`];
    const available = fixture(occupied);
    await available.book(body);
    assert.equal(available.writes.length, 2);
  }
});

test("previous bookings with a now-disallowed pairing can still be cancelled", async () => {
  const previous = { id: "booking", customerId: "customer", status: "Pending", petRecordId: "pet", serviceId: "laboratory-testing", serviceIds: ["laboratory-testing", "pet-grooming"], scheduleDate: "2030-01-05", scheduleTime: "09:00" };
  const app = fixture({ "appointments/booking": previous });
  await app.book({ ...previous, status: "Cancelled" });
  assert.equal(app.records.get("appointments/booking").status, "Cancelled");
});

test("only approved appointments can be marked completed through the API", async () => {
  for (const status of ["Pending", "Rejected", "Cancelled", "Expired", "Accepted", "Approved", "Confirmed"]) {
    const app = fixture({ "appointments/booking": { id: "booking", customerId: "customer", serviceId: "vaccination", status } });
    const request = app.book({ serviceId: "vaccination", status: "Completed" }, "admin");
    if (["Accepted", "Approved", "Confirmed"].includes(status)) {
      await request;
      assert.equal(app.writes.length, 1);
    } else {
      await assert.rejects(request, { statusCode: 400 });
      assert.equal(app.writes.length, 0);
    }
  }
});
