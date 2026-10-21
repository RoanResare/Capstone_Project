import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

// Run the production data service with in-memory Firestore and API ports.
const source = readFileSync(new URL("../src/app/services/scheduleData.js", import.meta.url), "utf8")
  .replace(/import\s+[\s\S]*?\s+from\s+"[^"]+";/g, "")
  .replace(/export /g, "");

function fixture() {
  const records = new Map();
  const queries = [];
  const timers = new Map();
  const events = new Map();
  let failListener;
  const ports = {
    auth: { currentUser: { uid: "customer", getIdToken: async () => "token" } },
    db: {}, isFirebaseConfigured: true,
    collection: (_db, name) => ({ collection: name }),
    where: (field, operator, value) => ({ field, operator, value }),
    orderBy: (field, direction) => ({ order: field, direction }),
    limit: value => ({ limit: value }),
    startAfter: value => ({ cursor: value }),
    query: (collection, ...constraints) => ({ ...collection, constraints }),
    getDocs: async query => {
      queries.push(query);
      return { docs: [...records.values()].filter(record =>
        query.collection === record.collection && query.constraints.every(c =>
          !c.field || record[c.field] === c.value) && query.constraints.every(c =>
          !c.order || c.order === "__name__" || record[c.order] !== undefined)
      ).map(record => ({ id: record.id, data: () => record })) };
    },
    apiClient: { get: async (url, { params }) => {
      const collection = url.split("/").at(-1);
      const all = [...records.values()].filter(record => record.collection === collection &&
        (!ports.customerId || record.customerId === ports.customerId));
      const offset = Number(params.cursor || 0);
      const page = all.slice(offset, offset + 500);
      return { data: { records: page, nextCursor: offset + 500 < all.length ? String(offset + 500) : "" } };
    }, put: async (_url, record) => {
      records.set(record.id, { ...record, collection: "pets", customerId: "customer" });
      return { data: { success: true } };
    } },
    buildAuthHeaders: () => ({}), assertAppropriatePetText: () => {},
    extractApiError: (_error, fallback) => fallback,
    window: { addEventListener: (event, handler) => events.set(event, handler), removeEventListener() {} },
    document: { visibilityState: "visible", addEventListener() {}, removeEventListener() {} },
    setTimeout: handler => { const id = timers.size + 1; timers.set(id, handler); return id; },
    clearTimeout: id => timers.delete(id),
    waitForFirebaseUserSession: async () => ports.auth.currentUser,
  };
  ports.onSnapshot = (query, onChange, onError) => {
    failListener = onError;
    queries.push(query);
    onChange({ docs: [] });
    return () => {};
  };
  const service = new Function(...Object.keys(ports), `${source}\nreturn {
    loadCustomerPetRecords, savePetRecordDocument, deletePetRecordDocument,
    loadAppointmentDocuments, subscribeAppointments
  };`)(...Object.values(ports));
  return { service, records, queries, ports, timers, events, failListener: () => failListener };
}

test("saved customer profiles remain visible when reloaded inside the cache lifetime", async () => {
  const { service } = fixture();
  const customer = { uid: "customer" };
  assert.deepEqual(await service.loadCustomerPetRecords(customer), []);
  await service.savePetRecordDocument({ id: "pet", petName: "Milo", gender: "Male" });
  const loaded = await service.loadCustomerPetRecords(customer);
  assert.equal(loaded.length, 1);
  assert.equal(loaded[0].petName, "Milo");
});

test("portal loads and live calendar updates include bookings without createdAt", async () => {
  const { service, records } = fixture();
  records.set("booking", { collection: "appointments", id: "booking", status: "Pending",
    scheduleDate: "2030-01-12", scheduleTime: "09:00" });
  assert.equal((await service.loadAppointmentDocuments())[0].id, "booking");
  const appointments = await new Promise(resolve => service.subscribeAppointments(resolve));
  assert.equal(appointments[0].id, "booking");
});

test("customer appointment subscriptions query only the signed-in customer's bookings", async () => {
  const { service, records, ports } = fixture();
  ports.customerId = "customer";
  for (const customerId of ["customer", "other"]) {
    records.set(customerId, { collection: "appointments", id: customerId, customerId });
  }
  const appointments = await new Promise(resolve =>
    service.subscribeAppointments(resolve, undefined, { customerId: "customer" }));
  assert.deepEqual(appointments.map(record => record.id), ["customer"]);
});

test("calendar synchronization loads every page instead of dropping bookings after 200", async () => {
  const { service, records } = fixture();
  for (let i = 0; i < 550; i++) records.set(String(i), { id: String(i), collection: "appointments" });
  const appointments = await new Promise(resolve => service.subscribeAppointments(resolve));
  assert.equal(appointments.length, 550);
});

test("polling synchronizes a customer booking even when the Firestore listener is denied", async () => {
  const { service, records, timers, failListener } = fixture();
  const updates = [];
  const stop = service.subscribeAppointments(records => updates.push(records));
  await new Promise(resolve => setImmediate(resolve));
  failListener()({ code: "permission-denied" });
  records.set("new", { id: "new", collection: "appointments", status: "Pending" });
  const refresh = [...timers.values()].at(-1);
  await refresh();
  assert.equal(updates.at(-1)[0].id, "new");
  stop();
  assert.equal(timers.size, 0);
});
