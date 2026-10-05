import assert from "node:assert/strict";
import { after, test } from "node:test";
import { createServer } from "vite";

const state = { writes: [], fail: false, listener: null, unsubscribed: false };
globalThis.__scheduleDataTest = state;
const mocks = {
  "firebase.js": "export const auth = {currentUser: {uid: 'user'}}, db = {}, isFirebaseConfigured = true;",
  "apiClient.js": "export const apiClient = {}; export function buildAuthHeaders() {} export function extractApiError() {}",
  "firebase/firestore": `const state = globalThis.__scheduleDataTest;
    export const doc = (db, name, id) => ({name, id});
    export const collection = (db, name) => ({name});
    export async function deleteDoc() {} export async function getDocs() {return {docs: []};}
    export async function setDoc(ref, data) {
      if (state.fail) throw new Error('Write denied');
      state.writes.push({ref, data});
    }
    export function onSnapshot(ref, next) {
      state.listener = next;
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

test("pet saves require strict Male/Female gender and never save photo fields", async () => {
  for (const gender of [undefined, "", "Others", "male"]) {
    await assert.rejects(service.savePetRecordDocument({id: "pet", gender}), /gender/);
  }
  assert.equal(state.writes.length, 0);
  for (const gender of ["Male", "Female"]) {
    await service.savePetRecordDocument({id: "pet", gender, photoURL: "old-photo", photoModerationId: "old"});
    const data = state.writes.at(-1).data;
    assert.equal(data.gender, gender);
    assert.equal("photoURL" in data, false);
    assert.equal("photoModerationId" in data, false);
  }
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
  state.fail = true;
  await assert.rejects(service.saveAvailabilitySlotDocument({id: "slot", isOpen: false}), /Write denied/);
  state.fail = false;
});
