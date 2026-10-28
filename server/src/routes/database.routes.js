const express = require("express");
const jwt = require("jsonwebtoken");
const { db, auth } = require("../config/firebaseAdmin");
const { ApiError } = require("../utils/ApiError");
const { asyncHandler } = require("../utils/asyncHandler");
const { verifyToken } = require("../middlewares/authenticate");
const { validateSessionSecurity } = require("../services/sessionSecurity.service");
const { getUserByAuthId, getUserByUid } = require("../services/user.service");
const { listRecords } = require("../services/scheduleRecords.service");
const { assertRead, assertWrite } = require("../database/browserAccess");
const { encode, decode, deepMerge } = require("../database/values");
const { isSupabaseAccessToken, verifySupabaseAccessToken } = require("../services/supabaseAuth.service");
const router = express.Router();
router.use((_req, _res, next) => db?.provider === "postgres" ? next() : next(new ApiError(404, "PostgreSQL API is disabled.")));
router.get("/token", verifyToken, asyncHandler(async (req, res) => {
  const secret = process.env.SUPABASE_JWT_SECRET;
  if (!secret || secret.length < 32) throw new ApiError(503, "Configure the staging Supabase JWT signing secret on the backend.");
  const token = jwt.sign({ role: "authenticated", auth_iat: Number(req.auth.claims.iat || req.auth.claims.auth_time || 0) }, secret,
    { algorithm: "HS256", issuer: "furfection-database", audience: "authenticated", subject: req.auth.user.uid, expiresIn: 300 });
  res.set("Cache-Control", "no-store");
  res.json({ token, expiresIn: 300 });
}));

router.use(asyncHandler(async (req, _res, next) => {
  const token = req.headers.authorization?.replace(/^Bearer /, "");
  if (!token) { req.databaseIdentity = { uid: "", claims: {} }; return next(); }
  let claims;
  let provider = "firebase-id-token";
  if (isSupabaseAccessToken(token)) {
    claims = await verifySupabaseAccessToken(token);
    provider = "supabase-auth";
  } else {
    try { claims = await auth.verifyIdToken(token, true); }
    catch (_error) { throw new ApiError(401, "A valid Supabase or Firebase session is required."); }
  }
  const uid = claims.uid || claims.sub;
  const user = provider === "supabase-auth" ? await getUserByAuthId(uid) : await getUserByUid(uid);
  const ownProfileRead = req.path === "/read" && req.body?.collection === "users" && req.body?.id === uid;
  if (!ownProfileRead && user && (user.accountStatus !== "active" || ["suspended", "banned"].includes(user.fraudStatus))) throw new ApiError(403, "This account is restricted.");
  // Profile bootstrap can precede creation of the database profile. Revocation
  // and network/session checks still apply to every authenticated request.
  req.auth = { user: user || { uid }, claims, token, provider };
  await validateSessionSecurity(req);
  req.databaseIdentity = { uid, user, claims };
  next();
}));
function validateReference(collection, id) {
  if (typeof collection !== "string" || collection.length > 100) throw new ApiError(400, "Invalid collection.");
  try { return id === undefined ? db.collection(collection) : db.collection(collection).doc(id); }
  catch (_error) { throw new ApiError(400, "Invalid database reference."); }
}
function publicPayload(collection, data) {
  if (collection !== "users") return data;
  const { password, passwordHash, passwordSalt, passwordVersion, ...safe } = data;
  return safe;
}
router.post("/read", asyncHandler(async (req, res) => {
  const { collection, id } = req.body || {};
  const ref = validateReference(collection, id);
  const snapshot = await ref.get();
  const data = snapshot.data();
  assertRead(collection, id, data, req.databaseIdentity);
  res.set("Cache-Control", "no-store");
  res.json({ exists: snapshot.exists, id, data: data ? encode(publicPayload(collection, data)) : null });
}));
router.post("/query", asyncHandler(async (req, res) => {
  const { collection, filters = [], orders = [], cursor, limit = 500 } = req.body || {};
  const identity = req.databaseIdentity;
  let query = validateReference(collection);
  if (!Array.isArray(filters) || filters.length > 10 || !Array.isArray(orders) || orders.length > 5 || !Number.isInteger(limit) || limit < 1 || limit > 500) throw new ApiError(400, "Invalid query.");
  const manager = ["admin", "staff"].includes(identity.user?.role);
  let records;
  if (["appointments", "pets"].includes(collection) && !manager) {
    if (!identity.user) throw new ApiError(403, "Sign in to load your records.");
    const result = await listRecords(collection, identity.user);
    records = result.records;
    // Canonical + legacy ownership comes from the same backend service as before.
    for (const filter of filters) {
      if (filter.op !== "==") throw new ApiError(400, "Unsupported customer query.");
      records = records.filter(record => record[filter.field] === decode(filter.value));
    }
    const direction = orders[0]?.direction === "desc" ? -1 : 1;
    records.sort((a, b) => direction * (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    if (cursor) records = records.filter(record => direction * (record.id < cursor[0] ? -1 : record.id > cursor[0] ? 1 : 0) > 0);
    records = records.slice(0, limit);
  } else {
    assertRead(collection, undefined, collection === "notifications" ? { targetUserId: identity.uid } : undefined, identity);
    // Scope notifications in SQL; never fetch another customer's rows then filter.
    if (collection === "notifications" && !manager) query = query.where("targetUserId", "==", identity.uid);
    for (const filter of filters) query = query.where(filter.field, filter.op, decode(filter.value));
    for (const order of orders) query = query.orderBy(order.field, order.direction);
    if (cursor) query = query.startAfter(...cursor.map(value => decode(value)));
    const snapshot = await query.limit(limit).get();
    records = snapshot.docs.map(doc => ({ ...publicPayload(collection, doc.data()), id: doc.id }));
  }
  res.set("Cache-Control", "no-store");
  res.json({ records: records.map(record => ({ id: record.id, data: encode(record) })) });
}));
function applyTransforms(before, encoded, now) {
  const patch = Object.create(null);
  for (const [key, value] of Object.entries(encoded)) {
    if (value?.__databaseTransform === "serverTimestamp") patch[key] = encode(now);
    else if (value?.__databaseTransform === "deleteField") patch[key] = undefined;
    else if (value?.__databaseTransform === "arrayUnion") patch[key] = [...(encode(before?.[key] || [])), ...value.values.filter(item => !(encode(before?.[key] || [])).some(old => JSON.stringify(old) === JSON.stringify(item)))];
    else patch[key] = value;
  }
  return patch;
}
router.post("/write", asyncHandler(async (req, res) => {
  const writes = req.body?.writes;
  if (!Array.isArray(writes) || !writes.length || writes.length > 100) throw new ApiError(400, "Invalid write batch.");
  const identity = req.databaseIdentity;
  await db.runTransaction(async tx => {
    const loaded = await Promise.all(writes.map(async write => {
      if (!["set", "update", "delete"].includes(write.operation)) throw new ApiError(400, "Invalid write operation.");
      const ref = validateReference(write.collection, write.id);
      return { write, ref, snapshot: await tx.get(ref) };
    }));
    const staged = new Map();
    for (const { write, ref, snapshot } of loaded) {
      const before = staged.has(ref.path) ? staged.get(ref.path) : snapshot.data();
      if (write.operation === "delete") { assertWrite(write.collection, write.id, before, null, identity, "delete"); tx.delete(ref); staged.set(ref.path, undefined); continue; }
      if (write.operation === "update" && !before) throw new ApiError(404, "Document not found.");
      const patch = applyTransforms(before, write.data || {}, new Date());
      const after = write.merge ? deepMerge(encode(before || {}), patch) : write.operation === "update" ? { ...encode(before || {}), ...patch } : patch;
      for (const key of Object.keys(after)) if (after[key] === undefined) delete after[key];
      const data = decode(after, db);
      assertWrite(write.collection, write.id, before, data, identity, write.operation);
      tx.set(ref, data);
      staged.set(ref.path, data);
    }
  });
  res.json({ success: true });
}));
module.exports = router;
