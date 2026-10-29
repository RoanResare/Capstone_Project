import assert from "node:assert/strict";
import { after, test } from "node:test";
import { createServer } from "vite";

const state = { writes: [], fail: false, listener: null, unsubscribed: false, refreshes: 0,
  attempts: 0, permissionFailures: 0, subscriptions: 0, deleteFailures: 0, deletions: [],
  apiRequests: [], apiFailure: null, getDocsCalls: 0, docs: [] };
state.auth = {currentUser: {uid: "user", async getIdToken(force) {
  if (force) state.refreshes++; return "fresh-token";
}}};
state.client = Object.fromEntries(["get", "put", "delete"].map((method) => [method, async (...args) => {
  state.apiRequests.push({method, args});
  if (state.apiFailure) throw state.apiFailure;
  return {data: {success: true, slots: [{id: "backend-slot", isOpen: false}]}};
}]));
globalThis.__scheduleDataTest = state;
const mocks = {
  "firebase.js": "export const auth = globalThis.__scheduleDataTest.auth, db = {}, isFirebaseConfigured = true;",
  "apiClient.js": `export const apiClient = globalThis.__scheduleDataTest.client;
    export function buildAuthHeaders(token) {return {Authorization: 'Bearer ' + token};}
    export function extractApiError(error) {return error.response?.data?.message || error.message;}`,
  "firebase/firestore": `const state = globalThis.__scheduleDataTest;
    export const doc = (db, name, id) => ({name, id});
    export const collection = (db, name) => ({name});
    export async function deleteDoc(ref) {
      if (state.deleteFailures > 0) {
        state.deleteFailures--;
        throw Object.assign(new Error('Permission denied'), {code: 'permission-denied'});
      }
      state.deletions.push(ref);
    }
    export async function getDocs() {
      state.getDocsCalls++;
      return {docs: state.docs.map((entry) => ({id: entry.id, data: () => entry.data}))};
    }
    export async function setDoc(ref, data) {
      state.attempts++;
      if (state.permissionFailures > 0) {
        state.permissionFailures--;
        throw Object.assign(new Error('Permission denied'), {code: 'permission-denied'});
      }
      if (state.fail) throw new Error('Write denied');
      state.writes.push({ref, data});
    }
    export function onSnapshot(ref, next, error) {
      state.subscriptions++;
      state.listener = next;
      state.error = error;
      return () => {state.unsubscribed = true;};
    }`,
};
const server = await createServer({
  configFile: false, server: {middlewareMode: true}, appType: "custom", logLevel: "silent",
  ssr: {noExternal: ["firebase"]},
  plugins: [{name: "schedule-test", enforce: "pre",
    resolveId(source) {
      const key = Object.keys(mocks).find((key) => source === key || source.endsWith(`/${key}`));
      if (key) return `\0schedule-test:${key}`;
    },
    load(id) {if (id.startsWith("\0schedule-test:")) return mocks[id.slice("\0schedule-test:".length)];},
  }],
});
after(async () => {await server.close(); delete globalThis.__scheduleDataTest;});
const service = await server.ssrLoadModule("/src/app/services/scheduleData.js");

test("concurrent collection loads share one Firestore read", async () => {
  state.getDocsCalls = 0;
  state.docs = [{id: "pet", data: {petName: "Cache"}}];
  const [first, second] = await Promise.all([
    service.loadPetRecordDocuments(),
    service.loadPetRecordDocuments(),
  ]);
  assert.equal(state.getDocsCalls, 1);
  assert.deepEqual(first, [{id: "pet", petName: "Cache"}]);
  assert.deepEqual(second, first);
  state.docs = [];
});

test("concurrent availability loads share one backend request", async () => {
  const requests = state.apiRequests.length;
  const [first, second] = await Promise.all([
    service.loadAvailabilitySlotDocuments(),
    service.loadAvailabilitySlotDocuments(),
  ]);
  assert.equal(state.apiRequests.length, requests + 1);
  assert.equal(state.apiRequests.at(-1).method, "get");
  assert.deepEqual(first, [{id: "backend-slot", isOpen: false}]);
  assert.deepEqual(second, first);
});

test("pet saves require strict Male/Female gender and never save photo fields", async () => {
  for (const gender of [undefined, "", "Others", "male"]) {
    await assert.rejects(service.savePetRecordDocument({id: "pet", gender}), /gender/);
  }
  assert.equal(state.writes.length, 0);
  for (const gender of ["Male", "Female"]) {
    await service.savePetRecordDocument({id: "pet", petName: "Milo", gender, photoURL: "old-photo", photoModerationId: "old"});
    const request = state.apiRequests.at(-1);
    assert.equal(request.method, "put");
    assert.equal(request.args[0], "/auth/pets/pet");
    const data = request.args[1];
    assert.equal(data.gender, gender);
    assert.equal("photoURL" in data, false);
    assert.equal("photoModerationId" in data, false);
  }
});

test("inappropriate pet text is rejected before any API or Firestore write", async () => {
  const requests = state.apiRequests.length;
  const writes = state.writes.length;
  await assert.rejects(service.savePetRecordDocument({ id: "pet", gender: "Male", petName: "f u c k" }), /inappropriate/);
  await assert.rejects(service.savePetRecordDocument({ id: "pet", gender: "Male", petName: "Milo", notes: "shit!" }), /inappropriate/);
  await assert.rejects(service.savePetRecordDocument({ id: "pet", gender: "Male", petName: "tanginamo", notes: "tanginamo0" }), /inappropriate/);
  for (const value of ["goblok", "G0B10K123", "banci", "putain", "你这个傻逼"]) {
    await assert.rejects(service.savePetRecordDocument({ id: "pet", gender: "Male", petName: value }), /inappropriate/);
    await assert.rejects(service.savePetRecordDocument({ id: "pet", gender: "Male", petName: "Milo", notes: value }), /inappropriate/);
  }
  assert.equal(state.apiRequests.length, requests);
  assert.equal(state.writes.length, writes);
});

test("availability snapshot streams slot changes and supports cleanup", () => {
  let slots;
  const stop = service.subscribeAvailabilitySlots((next) => {slots = next;});
  state.listener({docs: [{id: "slot", data: () => ({id: "wrong", isOpen: false})}]});
  assert.deepEqual(slots, [{id: "slot", isOpen: false}]);
  state.listener({docs: [{id: "slot", data: () => ({isOpen: true})}]});
  assert.equal(slots[0].isOpen, true);
  stop();
  assert.equal(state.unsubscribed, true);
});

test("failed schedule writes propagate instead of reporting success", async () => {
  state.apiFailure = new Error("Write denied");
  await assert.rejects(service.saveAvailabilitySlotDocument({id: "slot", isOpen: false}), /Write denied/);
  state.apiFailure = null;
});

test("disable and reopen writes use authenticated backend endpoints, not browser Firestore writes", async () => {
  for (const isOpen of [false, true]) {
    const refreshes = state.refreshes;
    const writes = state.writes.length;
    await service.saveAvailabilitySlotDocument({id: "slot", isOpen});
    assert.equal(state.refreshes, refreshes);
    assert.equal(state.writes.length, writes);
    const request = state.apiRequests.at(-1);
    assert.equal(request.method, "put");
    assert.equal(request.args[0], "/auth/availability-slots/slot");
    assert.equal(request.args[1].isOpen, isOpen);
    assert.equal(request.args[2].headers.Authorization, "Bearer fresh-token");
  }
});

test("backend role-denial errors are returned without retrying unauthorized writes", async () => {
  const attempts = state.apiRequests.length;
  state.apiFailure = {response: {data: {message: "Only admin and staff can manage appointment slots."}}};
  await assert.rejects(service.saveAvailabilitySlotDocument({id: "slot"}),
    /Only admin and staff/);
  assert.equal(state.apiRequests.length, attempts + 1);
  state.apiFailure = null;
});

test("availability listener falls back to backend reads after a denied claims refresh", async () => {
  const errors = [];
  let slots;
  const subscriptions = state.subscriptions;
  const stop = service.subscribeAvailabilitySlots((next) => {slots = next;}, (error) => errors.push(error));
  await state.error({code: "permission-denied"});
  assert.equal(state.subscriptions, subscriptions + 2);
  await state.error({code: "permission-denied"});
  assert.equal(errors.length, 0);
  assert.deepEqual(slots, [{id: "backend-slot", isOpen: false}]);
  assert.equal(state.apiRequests.at(-1).method, "get");
  assert.equal(state.subscriptions, subscriptions + 2);
  stop();
});

test("disposed listeners do not restart after an in-flight token refresh", async () => {
  const user = state.auth.currentUser;
  const original = user.getIdToken;
  let resolve;
  user.getIdToken = () => new Promise((done) => {resolve = done;});
  const stop = service.subscribeAvailabilitySlots(() => assert.fail("Disposed listener emitted data"));
  const subscriptions = state.subscriptions;
  const pending = state.error({code: "permission-denied"});
  stop();
  resolve("token");
  await pending;
  assert.equal(state.subscriptions, subscriptions);
  user.getIdToken = original;
});

test("slot removal uses the backend tombstone endpoint and signed-out writes never report success", async () => {
  await service.deleteAvailabilitySlotDocument("slot");
  assert.equal(state.apiRequests.at(-1).method, "delete");
  assert.equal(state.apiRequests.at(-1).args[0], "/auth/availability-slots/slot");
  const user = state.auth.currentUser;
  state.auth.currentUser = null;
  await assert.rejects(service.saveAvailabilitySlotDocument({id: "slot"}), /must be signed in/);
  await assert.rejects(service.deleteAvailabilitySlotDocument("slot"), /must be signed in/);
  state.auth.currentUser = user;
});
