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
    removeJsonCache: () => {},
    readJsonCache: () => null, writeJsonCache: () => {},
    window: { addEventListener: (event, handler) => events.set(event, handler), removeEventListener() {} },
    document: { visibilityState: "visible", addEventListener() {}, removeEventListener() {} },
    setTimeout: handler => { const id = timers.size + 1; timers.set(id, handler); return id; },
    clearTimeout: id => timers.delete(id),
    waitForFirebaseUserSession: async () => ports.auth.currentUser,
  };
  ports.onSnapshot = (query, options, next, error) => {
    const onChange = typeof options === "function" ? options : next;
    const onError = typeof options === "function" ? next : error;
    failListener = onError;
    queries.push(query);
    onChange({ docs: [], metadata: { fromCache: query.collection === "availabilitySlots" } });
    return () => {};
  };
  const service = new Function(...Object.keys(ports), `${source}\nreturn {
    loadCustomerPetRecords, savePetRecordDocument, deletePetRecordDocument,
    loadAppointmentDocuments, subscribeAppointments, invalidateScheduleCache, clearScheduleCache,
    subscribeAvailabilitySlots
  };`)(...Object.entries(ports).map(([name, value]) => name === "onSnapshot" ? (...args) => ports.onSnapshot(...args) : value));
  return { service, records, queries, ports, timers, events, failListener: () => failListener };
}

test("overlapping complete API loads share every page, but later loads remain fresh", async () => {
  const { service, records, ports } = fixture();
  for (let i = 0; i < 550; i++) records.set(String(i), { id: String(i), collection: "appointments" });
  let requests = 0;
  const get = ports.apiClient.get;
  ports.apiClient.get = async (...args) => { requests++; return get(...args); };
  const [first, second] = await Promise.all([service.loadAppointmentDocuments(), service.loadAppointmentDocuments()]);
  assert.equal(requests, 2);
  assert.equal(first.length, 550);
  assert.deepEqual(second, first);
  records.set("new", { id: "new", collection: "appointments" });
  assert.equal((await service.loadAppointmentDocuments()).length, 551);
  assert.equal(requests, 4);
});

test("invalidation, logout and account changes never reuse an earlier pending load", async () => {
  for (const change of ["write", "logout", "account"]) {
    const { service, ports } = fixture();
    const resolvers = [];
    ports.apiClient.get = () => new Promise(resolve => resolvers.push(resolve));
    const first = service.loadAppointmentDocuments();
    await new Promise(resolve => setImmediate(resolve));
    if (change === "write") service.invalidateScheduleCache("appointments");
    if (change === "logout") service.clearScheduleCache();
    if (change === "account") ports.auth.currentUser = { uid: "other", getIdToken: async () => "other-token" };
    const firstResult = first.catch(error => error);
    const second = service.loadAppointmentDocuments();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(resolvers.length, 2);
    resolvers[0]({ data: { records: [{ id: "old" }] } });
    await firstResult;
    // Completion of the old request must not remove the new pending entry.
    const third = service.loadAppointmentDocuments();
    resolvers[1]({ data: { records: [{ id: "fresh" }] } });
    assert.deepEqual(await second, [{ id: "fresh" }]);
    assert.deepEqual(await third, [{ id: "fresh" }]);
    assert.equal(resolvers.length, 2);
  }
});

test("failed shared reads are evicted and can be retried", async () => {
  const { service, ports } = fixture();
  ports.apiClient.get = async () => { throw new Error("offline"); };
  await assert.rejects(service.loadAppointmentDocuments(), /offline/);
  ports.apiClient.get = async () => ({ data: { records: [{ id: "recovered" }] } });
  assert.deepEqual(await service.loadAppointmentDocuments(), [{ id: "recovered" }]);
});

test("overlapping availability focus events keep one request and one polling timer", async () => {
  const { service, ports, timers, events } = fixture();
  let requests = 0;
  let resolve;
  ports.apiClient.get = () => { requests++; return new Promise(done => { resolve = done; }); };
  const updates = [];
  const stop = service.subscribeAvailabilitySlots(slots => updates.push(slots));
  await new Promise(done => setImmediate(done));
  events.get("focus")();
  events.get("focus")();
  assert.equal(requests, 1);
  resolve({ data: { slots: [{ id: "slot" }] } });
  await new Promise(done => setImmediate(done));
  assert.equal(timers.size, 1);
  assert.deepEqual(updates, [[{ id: "slot" }]]);
  stop();
  assert.equal(timers.size, 0);
});

test("availability shares one live listener, streams edits and deletions, and releases the last subscriber", async () => {
  const { service, ports, timers, events } = fixture();
  let next, fail, stopped = 0, requests = 0;
  ports.onSnapshot = (_query, options, onChange, onError) => {
    assert.equal(options.includeMetadataChanges, true);
    next = onChange; fail = onError;
    return () => { stopped++; };
  };
  ports.apiClient.get = async () => { requests++; return { data: { slots: [{ id: "fallback" }] } }; };
  const first = [], second = [];
  const stopFirst = service.subscribeAvailabilitySlots(value => first.push(value));
  const stopSecond = service.subscribeAvailabilitySlots(value => second.push(value));
  const emit = docs => next({ metadata: { fromCache: false }, docs: docs.map(data => ({ id: data.id, data: () => data })) });
  emit([{ id: "slot", isOpen: true }]);
  emit([{ id: "slot", isOpen: false }]);
  emit([]);
  events.get("focus")();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(requests, 0);
  assert.equal(timers.size, 0);
  assert.deepEqual(first, second);
  assert.deepEqual(first.at(-1), []);
  stopFirst();
  assert.equal(stopped, 0);
  fail({ code: "permission-denied" });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(requests, 1);
  assert.equal(timers.size, 1);
  assert.deepEqual(second.at(-1), [{ id: "fallback" }]);
  assert.equal(first.length, 3);
  stopSecond();
  assert.equal(stopped, 1);
  assert.equal(timers.size, 0);
  emit([{ id: "late" }]);
  assert.equal(second.length, 4);
});

test("appointment consumers share a listener and retain it until the last cleanup", async () => {
  const { service, ports } = fixture();
  let listeners = 0, stopped = 0;
  const subscribe = ports.onSnapshot;
  ports.onSnapshot = (...args) => { listeners++; subscribe(...args); return () => { stopped++; }; };
  const options = { expectedUid: "customer", customerId: "customer" };
  const stopFirst = service.subscribeAppointments(() => {}, assert.fail, options);
  const stopSecond = service.subscribeAppointments(() => {}, assert.fail, options);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(listeners, 1);
  stopFirst(); assert.equal(stopped, 0);
  stopSecond(); assert.equal(stopped, 1);
});

test("complete staff snapshots replace polling and include old records; denied listeners retain API fallback", async () => {
  const { service, ports, timers } = fixture();
  let next, fail, requests = 0;
  ports.onSnapshot = (_query, _options, onChange, onError) => {
    next = onChange; fail = onError;
    return () => {};
  };
  ports.apiClient.get = async () => { requests++; return { data: { records: [{ id: "api-fallback" }] } }; };
  const updates = [];
  const stop = service.subscribeAppointments(value => updates.push(value), assert.fail,
    { expectedUid: "customer", completeSnapshot: true });
  await new Promise(resolve => setImmediate(resolve));
  const records = Array.from({ length: 550 }, (_, id) => ({ id: String(id), data: () => ({ status: "Pending" }) }));
  next({ metadata: { fromCache: false }, docs: records });
  assert.equal(updates.at(-1).length, 550);
  assert.equal(requests, 0);
  assert.equal(timers.size, 0);
  fail({ code: "permission-denied" });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(requests, 1);
  assert.deepEqual(updates.at(-1), [{ id: "api-fallback" }]);
  assert.equal(timers.size, 1);
  stop();
  assert.equal(timers.size, 0);
});

test("a slow fallback cannot overwrite a newer authoritative availability snapshot", async () => {
  const { service, ports, timers } = fixture();
  let next, resolve;
  ports.onSnapshot = (_query, _options, onChange) => { next = onChange; return () => {}; };
  ports.apiClient.get = () => new Promise(done => { resolve = done; });
  const updates = [];
  const stop = service.subscribeAvailabilitySlots(value => updates.push(value));
  next({ metadata: { fromCache: true }, docs: [] });
  await new Promise(done => setImmediate(done));
  next({ metadata: { fromCache: false }, docs: [{ id: "new", data: () => ({ isOpen: false }) }] });
  resolve({ data: { slots: [{ id: "old", isOpen: true }] } });
  await new Promise(done => setImmediate(done));
  assert.deepEqual(updates, [[{ id: "new", isOpen: false }]]);
  assert.equal(timers.size, 0);
  ports.auth.currentUser = { uid: "other" };
  next({ metadata: { fromCache: false }, docs: [] });
  assert.equal(updates.length, 1);
  stop();
});

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
