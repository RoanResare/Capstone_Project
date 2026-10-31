import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { normalizePromoInput, validatePromoStart } from "../shared/lowCostKaponPromo.mjs";

function fixture() {
  const state = { record: null, reads: 0, changes: [], errors: [], requests: [], timers: new Map(), cache: new Map() };
  const snapshot = () => ({ exists: () => Boolean(state.record), data: () => state.record });
  const context = { module: { exports: {} }, console,
    auth: { currentUser: { id: "employee" } }, db: {}, isSupabaseConfigured: true, isPostgresEnabled: true,
    normalizePromoInput, validatePromoStart,
    doc: (_db, collection, id) => ({ collection, id }),
    getDoc: async () => { state.reads++; if (state.readError) throw state.readError; return snapshot(); },
    onSnapshot: (_ref, next, error) => { state.next = next; state.error = error; return () => { state.stopped = true; }; },
    getSupabaseAccessToken: async () => "employee-token",
    buildAuthHeaders: token => ({ Authorization: `Bearer ${token}` }), extractApiError: error => error.message,
    apiClient: { put: async (url, payload, options) => {
      state.requests.push({ url, payload, options });
      state.record = { ...payload, isActive: payload.action !== "deactivate", revision: payload.expectedRevision + 1 };
      return { data: { promo: state.record } };
    } },
    readJsonCache: key => state.cache.get(key), writeJsonCache: (key, value) => state.cache.set(key, value), removeJsonCache: key => state.cache.delete(key),
    window: new EventTarget(), document: Object.assign(new EventTarget(), { visibilityState: "visible" }),
    setInterval: callback => { state.timers.set(1, callback); return 1; }, clearInterval: id => state.timers.delete(id),
  };
  const source = readFileSync(new URL("../src/app/services/kaponPromo.js", import.meta.url), "utf8")
    .replace(/^import .*;\r?$/gm, "").replaceAll("export async function", "async function").replaceAll("export function", "function");
  vm.runInNewContext(`${source}\nmodule.exports={subscribeKaponPromo,saveKaponPromo};`, context);
  const service = context.module.exports;
  return { state, context, snapshot, ...service, subscribe: () => service.subscribeKaponPromo(value => state.changes.push(value), error => state.errors.push(error)) };
}
const flush = () => new Promise(resolve => setImmediate(resolve));

test("promotion loads through the authenticated API even when realtime never subscribes", async () => {
  const app = fixture(); const stop = app.subscribe(); await flush();
  assert.equal(app.state.reads, 1);
  assert.equal(app.state.changes.length, 1);
  assert.equal(app.state.changes[0], null);
  stop();
});

test("realtime failure falls back to confirmed reads and polling persists activation after resubscription", async () => {
  const app = fixture(); let stop = app.subscribe(); await flush();
  const saved = await app.saveKaponPromo({ action: "activate", expectedRevision: 0, title: "Low-Cost Kapon", formLink: "https://forms.gle/test123" });
  app.state.error(new Error("Realtime unavailable")); await flush();
  assert.equal(app.state.errors.length, 0);
  assert.equal(app.state.changes.at(-1).isActive, true);
  assert.equal(app.state.requests[0].url, "/auth/promotions/low-cost-kapon");
  assert.equal(app.state.requests[0].options.headers.Authorization, "Bearer employee-token");
  stop(); assert.equal(app.state.timers.size, 0);
  stop = app.subscribe(); await flush();
  assert.equal(app.state.changes.at(-1).revision, saved.revision);
  app.state.record = { isActive: false, revision: 2 };
  app.state.timers.get(1)(); await flush();
  assert.equal(app.state.changes.at(-1).isActive, false);
  stop(); assert.ok(app.state.stopped);
});

test("actual read failures remain errors and disposed listeners cannot update state", async () => {
  const app = fixture(); app.state.readError = new Error("Access denied");
  const stop = app.subscribe(); await flush();
  assert.equal(app.state.errors.length, 1);
  assert.equal(app.state.changes.length, 0);
  stop(); app.state.next(app.snapshot());
  assert.equal(app.state.changes.length, 0);
});
