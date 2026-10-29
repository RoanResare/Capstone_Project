const { db } = require("../config/postgresDatabase");
const { ApiError } = require("../utils/ApiError");

function ownsRecord(record, user) {
  // Explicit ownership wins over legacy email matches.
  if (record.customerId) return record.customerId === user.uid;
  if (record.ownerId) return record.ownerId === user.uid;
  const email = String(record.customerEmail || "").trim().toLowerCase();
  return Boolean(email && email === String(user.email || "").trim().toLowerCase());
}

async function listRecords(collectionName, user, { cursor = "", limit = 500 } = {}) {
  if (!user || !["customer", "admin", "staff"].includes(user.role)) {
    throw new ApiError(403, "You cannot access these records.");
  }
  const collection = db.collection(collectionName);
  const pageSize = Math.min(500, Math.max(1, Number(limit) || 500));
  if (user.role === "customer") {
    const lookups = [["customerId", user.uid], ["ownerId", user.uid]];
    if (user.email) lookups.push(["customerEmail", user.email.trim().toLowerCase()]);
    const snapshots = await Promise.all(lookups.map(([field, value]) => collection.where(field, "==", value).get()));
    const records = new Map();
    for (const snapshot of snapshots) for (const doc of snapshot.docs) {
      if (ownsRecord(doc.data(), user)) records.set(doc.id, { ...doc.data(), id: doc.id, customerId: user.uid });
    }
    return { records: [...records.values()], nextCursor: "" };
  }
  let query = collection.orderBy("__name__").limit(pageSize + 1);
  if (cursor) query = query.startAfter(cursor);
  const snapshot = await query.get();
  const page = snapshot.docs.slice(0, pageSize);
  return {
    records: page.map(doc => ({ ...doc.data(), id: doc.id })),
    nextCursor: snapshot.docs.length > pageSize ? page.at(-1).id : "",
  };
}

module.exports = { ownsRecord, listRecords };
