import { apiClient, buildAuthHeaders } from "./apiClient.js";
import { getApplicationAccessToken, getApplicationIdentity } from "./databaseToken.js";
import { auth } from "./supabaseSession.js";

const TYPE = "__furfection_type__";
const documentCaches = new Map();
function cacheFor(identity) {
  if (!documentCaches.has(identity)) documentCaches.set(identity, new Map());
  return documentCaches.get(identity);
}
function encode(value) {
  if (value instanceof Date) return { [TYPE]: "timestamp", seconds: Math.floor(value.getTime() / 1000), nanoseconds: (value.getTime() % 1000) * 1e6 };
  if (value?.toDate && Number.isInteger(value.seconds)) return { [TYPE]: "timestamp", seconds: value.seconds, nanoseconds: value.nanoseconds };
  if (Array.isArray(value)) return value.map(encode);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined).map(([key, item]) => [key, encode(item)]));
  return value;
}
function decode(value) {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(decode);
  if (value[TYPE] === "timestamp") return { seconds: value.seconds, nanoseconds: value.nanoseconds,
    toDate: () => new Date(value.seconds * 1000 + value.nanoseconds / 1e6),
    toMillis: () => value.seconds * 1000 + value.nanoseconds / 1e6,
    toJSON: () => ({ seconds: value.seconds, nanoseconds: value.nanoseconds }) };
  if (value[TYPE] === "map") return Object.fromEntries(value.entries.map(([key, item]) => [key, decode(item)]));
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, decode(item)]));
}
async function request(endpoint, body) {
  const identity = await getApplicationIdentity();
  const token = await getApplicationAccessToken();
  try {
    const response = await apiClient.post(`/database/${endpoint}`, body, { headers: token ? buildAuthHeaders(token) : {} });
    if (identity !== await getApplicationIdentity()) throw new Error("Your account changed.");
    return response.data;
  } catch (error) {
    if (error.response?.status === 403) error.code = "permission-denied";
    throw error;
  }
}
export const collection = (_db, name) => ({ collectionName: name, constraints: [] });
export const doc = (_db, name, id) => ({ collectionName: name, id, path: `${name}/${id}` });
export const where = (field, op, value) => ({ kind: "where", field, op, value: encode(value) });
export const orderBy = (field, direction = "asc") => ({ kind: "order", field, direction });
export const limit = count => ({ kind: "limit", count });
export const startAfter = (...values) => ({ kind: "cursor", values });
export const query = (reference, ...constraints) => ({ ...reference, constraints: [...reference.constraints, ...constraints] });
export const serverTimestamp = () => ({ __databaseTransform: "serverTimestamp" });
export const deleteField = () => ({ __databaseTransform: "deleteField" });
export const arrayUnion = (...values) => ({ __databaseTransform: "arrayUnion", values: values.map(encode) });
function snapshot(reference, payload) {
  const data = payload.exists ? decode(payload.data) : undefined;
  return { id: reference.id, ref: reference, exists: () => payload.exists, data: () => data,
    get: field => field.split(".").reduce((value, key) => value?.[key], data) };
}
export async function getDoc(reference) {
  const payload = await request("read", { collection: reference.collectionName, id: reference.id });
  const result = snapshot(reference, payload);
  const identity = await getApplicationIdentity();
  if (identity) cacheFor(identity).set(reference.path, result);
  return result;
}
export async function getDocFromCache(reference) {
  const identity = await getApplicationIdentity();
  const cached = identity && cacheFor(identity).get(reference.path);
  if (!cached) throw Object.assign(new Error("No cached document."), { code: "unavailable" });
  return cached;
}
function queryBody(reference) {
  const constraints = reference.constraints || [];
  const orders = constraints.filter(item => item.kind === "order").map(({ field, direction }) => ({ field, direction }));
  const cursor = constraints.find(item => item.kind === "cursor")?.values;
  let encodedCursor = cursor?.map(encode);
  if (cursor?.[0]?.data) encodedCursor = [...orders.map(order => encode(order.field === "__name__" ? cursor[0].id : cursor[0].get(order.field))), ...(!orders.some(order => order.field === "__name__") ? [cursor[0].id] : [])];
  return { collection: reference.collectionName, filters: constraints.filter(item => item.kind === "where").map(({ field, op, value }) => ({ field, op, value })), orders, cursor: encodedCursor,
    limit: constraints.find(item => item.kind === "limit")?.count || 500 };
}
export async function getDocs(reference) {
  const body = queryBody(reference);
  const bounded = (reference.constraints || []).some(item => item.kind === "limit");
  const docs = [];
  do {
    const payload = await request("query", body);
    const page = payload.records.map(record => snapshot(doc(null, reference.collectionName, record.id), { exists: true, data: record.data }));
    docs.push(...page);
    if (bounded || page.length < body.limit) break;
    const last = page.at(-1);
    body.cursor = [...body.orders.map(order => encode(order.field === "__name__" ? last.id : last.get(order.field))), ...(!body.orders.some(order => order.field === "__name__") ? [last.id] : [])];
  } while (true);
  return { docs, size: docs.length, empty: !docs.length, metadata: { fromCache: false }, forEach: callback => docs.forEach(callback) };
}
export function writeBatch() {
  const writes = [];
  const batch = {
    set(reference, data, options = {}) { writes.push({ collection: reference.collectionName, id: reference.id, operation: "set", data: encode(data), merge: Boolean(options.merge) }); return batch; },
    update(reference, data) { writes.push({ collection: reference.collectionName, id: reference.id, operation: "update", data: encode(data) }); return batch; },
    delete(reference) { writes.push({ collection: reference.collectionName, id: reference.id, operation: "delete" }); return batch; },
    async commit() {
      const result = await request("write", { writes });
      const identity = await getApplicationIdentity();
      if (identity) for (const write of writes) cacheFor(identity).delete(`${write.collection}/${write.id}`);
      return result;
    },
  };
  return batch;
}
export const setDoc = (reference, data, options) => writeBatch().set(reference, data, options).commit();
export const updateDoc = (reference, data) => writeBatch().update(reference, data).commit();
export const deleteDoc = reference => writeBatch().delete(reference).commit();
export function runTransaction() { throw new Error("Use the authenticated business API for PostgreSQL transactions."); }

export function onSnapshot(reference, options, next, error) {
  if (typeof options === "function") { error = next; next = options; }
  const user = auth?.currentUser;
  let disposed = false, channel, bootstrapped = false, refreshing = false, draining = false, refreshAgain = false;
  let current = new Map();
  const pending = new Set();
  const valid = () => !disposed && auth?.currentUser === user;
  const emit = () => {
    if (!valid()) return;
    if (reference.id) { next(current.get(reference.id) || snapshot(reference, { exists: false })); return; }
    const docs = [...current.values()];
    next({ docs, size: docs.length, empty: !docs.length, metadata: { fromCache: false } });
  };
  const refresh = async () => {
    if (!valid()) return;
    if (refreshing || draining) { refreshAgain = true; return; }
    refreshing = true;
    try {
      const result = reference.id ? await getDoc(reference) : await getDocs(reference);
      if (!valid()) return;
      current = new Map((reference.id ? result.exists() ? [result] : [] : result.docs).map(doc => [doc.id, doc]));
      bootstrapped = true;
      emit();
    } catch (err) { if (valid()) error?.(err); }
    finally {
      refreshing = false;
      if (refreshAgain && valid()) { refreshAgain = false; void refresh(); }
      else if (pending.size && valid()) void drain();
    }
  };
  const drain = async () => {
    if (!valid() || !bootstrapped || refreshing || draining) return;
    // Bounded/filtered queries need boundary reconciliation. An unlimited
    // collection listener can apply individual authorized document changes.
    if ((reference.constraints || []).length) { pending.clear(); void refresh(); return; }
    draining = true;
    const ids = [...pending]; pending.clear();
    await Promise.all(ids.map(async id => {
      try {
        const changed = await getDoc(doc(null, reference.collectionName, id));
        if (!valid()) return;
        if (changed.exists()) current.set(id, changed); else current.delete(id);
      } catch (err) {
        if (err.response?.status === 403 || err.response?.status === 404) current.delete(id);
        else if (valid()) error?.(err);
      }
    }));
    current = new Map([...current].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0));
    emit();
    draining = false;
    if (refreshAgain) { refreshAgain = false; void refresh(); }
    else if (pending.size) void drain();
  };
  void (async () => {
    const { supabase } = await import("../../supabaseClient.js");
    if (!valid()) return;
    channel = supabase.channel(`business-${reference.collectionName}-${crypto.randomUUID()}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "database_changes", filter: `collection_name=eq.${reference.collectionName}` }, event => {
        if (!valid()) return;
        if (reference.id && event.new.document_id !== reference.id) return;
        pending.add(event.new.document_id);
        if (!refreshing) void drain();
      })
      .subscribe(status => {
        if (!valid()) return;
        if (status === "SUBSCRIBED") void refresh();
        if (["CHANNEL_ERROR", "TIMED_OUT"].includes(status)) error?.(new Error("Database realtime connection is unavailable; reconnecting."));
      });
    // SDK retries the channel on reconnect. Each SUBSCRIBED event rehydrates
    // after subscription establishment, closing the initial fetch/listen race.
  })().catch(err => { if (valid()) error?.(err); });
  return () => { disposed = true; pending.clear(); if (channel) void channel.unsubscribe(); };
}
