import assert from "node:assert/strict";
import { after, test } from "node:test";
import { createServer } from "vite";

const server = await createServer({
  configFile: false, server: { middlewareMode: true }, appType: "custom", logLevel: "silent",
  plugins: [{ name: "appointment-reducer-test", enforce: "pre", transform(code, id) {
    if (id.replaceAll("\\", "/").endsWith("/context/AppContext.jsx")) {
      return `${code}\nexport { appReducer, normalizeStoredState };`;
    }
  } }],
});
after(async () => { await server.close(); });
const { appReducer, normalizeStoredState } = await server.ssrLoadModule("/src/app/context/AppContext.jsx");
const booking = { id: "appointment", customerId: "customer", petRecordId: "pet", petName: "Pet", service: "Consultation",
  scheduleDate: "2030-01-12", scheduleTime: "11:00", status: "Pending", createdAt: "2030-01-01T00:00:00Z" };
const create = { type: "CREATE_APPOINTMENT", payload: booking, meta: { actorName: "Customer", actorRole: "customer" } };

test("approved bookings remain occupied after their scheduled start passes", () => {
  for (const status of ["Accepted", "Confirmed", "Approved"]) {
    const loaded = normalizeStoredState({ appointments: [{ ...booking, status, scheduleDate: "2020-01-12" }] });
    assert.equal(loaded.appointments[0].status, status);
  }
});

test("snapshot arriving before the save response does not duplicate the booking", () => {
  const initial = normalizeStoredState({ appointments: [] });
  const synchronized = appReducer(initial, { type: "HYDRATE_SCHEDULE_DATA", payload: { appointments: [booking] } });
  const saved = appReducer(synchronized, create);
  assert.equal(saved.appointments.length, 1);
  assert.equal(saved.appointments[0].id, booking.id);
});

test("snapshot arriving after the local save also leaves one booking", () => {
  const initial = normalizeStoredState({ appointments: [] });
  const saved = appReducer(initial, create);
  const synchronized = appReducer(saved, { type: "HYDRATE_SCHEDULE_DATA", payload: { appointments: [booking] } });
  assert.equal(synchronized.appointments.length, 1);
});

test("a delayed local save cannot undo a status already received from Firestore", () => {
  const synchronized = normalizeStoredState({ appointments: [{ ...booking, status: "Accepted", assignedStaff: "Staff" }] });
  const saved = appReducer(synchronized, create);
  assert.equal(saved.appointments.length, 1);
  assert.equal(saved.appointments[0].status, "Accepted");
  assert.equal(saved.appointments[0].assignedStaff, "Staff");
});

test("cached duplicate IDs are removed without merging different bookings", () => {
  const loaded = normalizeStoredState({ appointments: [booking, booking, { ...booking, id: "another-booking" }] });
  assert.equal(loaded.appointments.length, 2);
  assert.deepEqual(new Set(loaded.appointments.map((record) => record.id)), new Set(["appointment", "another-booking"]));
});

test("cached duplicates keep their newest update, including a staff status change", () => {
  const loaded = normalizeStoredState({ appointments: [
    { ...booking, status: "Accepted", updatedAt: "2030-01-02T00:00:00Z" },
    { ...booking, status: "Pending", updatedAt: "2030-01-01T00:00:00Z" },
  ] });
  assert.equal(loaded.appointments.length, 1);
  assert.equal(loaded.appointments[0].status, "Accepted");
});
