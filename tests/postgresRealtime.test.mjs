import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const source = readFileSync(new URL("../src/app/services/postgresBrowser.js", import.meta.url), "utf8")
  .replace(/import\s+[\s\S]*?\s+from\s+"[^"]+";/g, "")
  .replace('await import("../../supabaseClient.js")', "await getRealtimeClient()")
  .replace(/export /g, "");
const flush = () => new Promise(resolve => setImmediate(resolve));
function fixture() {
  const auth = { currentUser: { uid: "synthetic", getIdToken: async () => "firebase-token" } };
  const records = new Map([["a", { id: "a", value: 1 }]]);
  const calls = [];
  let event, status, unsubscribed = 0, queryGate;
  const channel = { on(_type, options, callback) { assert.equal(options.event, "INSERT"); event = callback; return channel; },
    subscribe(callback) { status = callback; return channel; }, async unsubscribe() { unsubscribed++; } };
  const apiClient = { async post(url, body, options) {
    assert.equal(options.headers.Authorization, "Bearer firebase-token");
    calls.push({ url, body });
    if (url.endsWith("query")) {
      const rows = [...records.values()].map(data => ({ id: data.id, data }));
      if (queryGate) await queryGate();
      return { data: { records: rows } };
    }
    if (url.endsWith("read")) return { data: { exists: records.has(body.id), id: body.id, data: records.get(body.id) } };
    if (url.endsWith("write")) return { data: { success: true } };
    throw new Error("Unexpected endpoint");
  } };
  const getRealtimeClient = async () => ({ supabase: { channel: () => channel } });
  const service = new Function("auth", "apiClient", "buildAuthHeaders", "getRealtimeClient", `${source}\nreturn {onSnapshot,collection,doc,getDoc,getDocFromCache,getDocs,setDoc,arrayUnion,serverTimestamp};`)
    (auth, apiClient, token => ({ Authorization: `Bearer ${token}` }), getRealtimeClient);
  return { service, records, calls, auth, apiClient, emit: id => event({ new: { document_id: id } }),
    status: value => status(value), unsubscribed: () => unsubscribed, gate: fn => { queryGate = fn; } };
}

test("Supabase subscription bootstraps after subscribing, applies targeted changes/deletes and recovers on reconnect", async () => {
  const f = fixture(), updates = [], errors = [];
  const stop = f.service.onSnapshot(f.service.collection(null, "pets"), snapshot => updates.push(snapshot.docs.map(doc => doc.data())), error => errors.push(error));
  await flush();
  assert.equal(f.calls.length, 0);
  f.status("SUBSCRIBED"); await flush();
  assert.deepEqual(updates.at(-1), [{ id: "a", value: 1 }]);
  f.records.set("a", { id: "a", value: 2 }); f.emit("a"); await flush();
  assert.deepEqual(updates.at(-1), [{ id: "a", value: 2 }]);
  assert.equal(f.calls.filter(call => call.url.endsWith("query")).length, 1);
  f.records.delete("a"); f.emit("a"); await flush();
  assert.deepEqual(updates.at(-1), []);
  f.records.set("b", { id: "b", value: 3 }); f.status("SUBSCRIBED"); await flush();
  assert.deepEqual(updates.at(-1), [{ id: "b", value: 3 }]);
  const count = updates.length; stop();
  f.emit("b"); await flush();
  assert.equal(f.unsubscribed(), 1);
  assert.equal(updates.length, count);
  assert.deepEqual(errors, []);
});

test("changes arriving during the initial fetch are reconciled and old-account responses are ignored", async () => {
  const f = fixture(), updates = [];
  let finish;
  f.gate(() => new Promise(resolve => { finish = resolve; }));
  const stop = f.service.onSnapshot(f.service.collection(null, "pets"), snapshot => updates.push(snapshot.docs.map(doc => doc.data())), assert.fail);
  await flush(); f.status("SUBSCRIBED"); await flush();
  f.records.set("a", { id: "a", value: 9 }); f.emit("a");
  finish(); await flush(); await flush();
  assert.equal(updates.at(-1)[0].value, 9);
  const count = updates.length;
  f.auth.currentUser = { uid: "other" };
  f.emit("a"); await flush();
  assert.equal(updates.length, count);
  stop();
});

test("document snapshots expose expected APIs and caches do not cross accounts", async () => {
  const f = fixture(), ref = f.service.doc(null, "pets", "a");
  const snapshot = await f.service.getDoc(ref);
  assert.equal(snapshot.exists(), true);
  assert.equal(snapshot.data().value, 1);
  assert.equal((await f.service.getDocFromCache(ref)).data().value, 1);
  f.auth.currentUser = { uid: "other" };
  await assert.rejects(f.service.getDocFromCache(ref), /No cached/);
});

test("realtime token exchange deduplicates, refreshes on Firebase token changes and rejects old accounts", async () => {
  const tokenSource = readFileSync(new URL("../src/app/services/databaseToken.js", import.meta.url), "utf8")
    .replace(/import\s+[\s\S]*?\s+from\s+"[^"]+";/g, "").replace(/export /g, "");
  let firebaseToken = "first", requests = 0, finish;
  const auth = { currentUser: { getIdToken: async () => firebaseToken } };
  const apiClient = { async get() { requests++; return { data: { token: `bridge-${requests}`, expiresIn: 300 } }; } };
  const getToken = new Function("auth", "apiClient", "buildAuthHeaders", `${tokenSource}\nreturn getDatabaseAccessToken;`)(auth, apiClient, () => ({}));
  assert.deepEqual(await Promise.all([getToken(), getToken()]), ["bridge-1", "bridge-1"]);
  assert.equal(await getToken(), "bridge-1");
  assert.equal(requests, 1);
  firebaseToken = "new-firebase-session";
  assert.equal(await getToken(), "bridge-2");
  apiClient.get = () => new Promise(resolve => { finish = resolve; });
  firebaseToken = "pending";
  const oldRequest = getToken();
  await flush();
  auth.currentUser = null;
  finish({ data: { token: "old-account", expiresIn: 300 } });
  await assert.rejects(oldRequest, /account changed/);
  assert.equal(await getToken(), null);
});
