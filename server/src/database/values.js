const { Timestamp, GeoPoint } = require("firebase-admin/firestore");
const TYPE = "__furfection_type__";
function encode(value) {
  if (value === undefined) throw new TypeError("Undefined database values are not supported.");
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : { [TYPE]: "number", value: String(value) };
  if (value instanceof Date) return encode(Timestamp.fromDate(value));
  if (value instanceof Timestamp || (typeof value?.toDate === "function" && Number.isInteger(value.seconds))) {
    return { [TYPE]: "timestamp", seconds: value.seconds, nanoseconds: value.nanoseconds };
  }
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) return { [TYPE]: "bytes", value: Buffer.from(value).toString("base64") };
  if (value instanceof GeoPoint) return { [TYPE]: "geopoint", latitude: value.latitude, longitude: value.longitude };
  if (typeof value?.path === "string" && value.firestore) return { [TYPE]: "reference", value: value.path };
  if (Array.isArray(value)) return value.map(encode);
  if (typeof value !== "object") throw new TypeError("Unsupported database value.");
  const entries = Object.entries(value).map(([key, item]) => [key, encode(item)]);
  // Escape user maps with a reserved tag; tagged values cannot collide with data.
  return Object.hasOwn(value, TYPE) ? { [TYPE]: "map", entries } : Object.fromEntries(entries);
}
function decode(value, database) {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(item => decode(item, database));
  switch (value[TYPE]) {
    case "timestamp": return new Timestamp(value.seconds, value.nanoseconds);
    case "bytes": return Buffer.from(value.value, "base64");
    case "geopoint": return new GeoPoint(value.latitude, value.longitude);
    case "reference": return database ? database.doc(value.value) : { path: value.value };
    case "number": return Number(value.value);
    case "map": return Object.fromEntries(value.entries.map(([key, item]) => [key, decode(item, database)]));
    default: return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, decode(item, database)]));
  }
}
function deepMerge(previous, patch) {
  const result = { ...previous };
  for (const [key, value] of Object.entries(patch)) {
    let next = value;
    if (value && typeof value === "object" && !Array.isArray(value) && !value[TYPE] &&
        result[key] && typeof result[key] === "object" && !Array.isArray(result[key]) && !result[key][TYPE]) {
      next = deepMerge(result[key], value);
    }
    Object.defineProperty(result, key, { value: next, writable: true, configurable: true, enumerable: true });
  }
  return result;
}
module.exports = { TYPE, encode, decode, deepMerge };
