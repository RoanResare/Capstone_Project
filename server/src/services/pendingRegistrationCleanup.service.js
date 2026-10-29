const { db } = require("../config/firebaseAdmin");
const { deleteSupabaseUser } = require("./supabaseAuth.service");
const { env } = require("../config/env");

const CLEANUP_INTERVAL_MS = 15 * 60 * 1000;

function getExpiry(profile = {}) {
  const value = profile.verificationExpiresAt;
  return value?.toDate?.() || new Date(value || 0);
}

async function purgeExpiredPendingRegistrations(now = new Date()) {
  const snapshot = await db.collection("users").where("verificationExpiresAt", "<=", now).get();
  let removed = 0;
  for (const entry of snapshot.docs) {
    const profileRef = entry.ref;
    const uid = profileRef.id;
    const claimed = await db.runTransaction(async (transaction) => {
      const profile = await transaction.get(profileRef);
      if (!profile.exists) return false;
      const current = profile.data() || {};
      if (!["pending", "expired"].includes(current.verificationStatus) || getExpiry(current) > now) return false;
      if (current.verificationStatus === "pending") {
        transaction.update(profileRef, { verificationStatus: "expired", updatedAt: now.toISOString() });
      }
      return true;
    });
    if (!claimed) continue;
    try {
      await deleteSupabaseUser(entry.data()?.authUserId || uid);
    } catch (error) {
      if (error?.statusCode !== 404) {
        console.warn("[registration] Expired pending Supabase account cleanup failed.", { uid, code: error?.code || "" });
        continue;
      }
    }
    const deleted = await db.runTransaction(async (transaction) => {
      const profile = await transaction.get(profileRef);
      if (!profile.exists) return false;
      const current = profile.data() || {};
      if (current.verificationStatus !== "expired" || getExpiry(current) > now) return false;
      const usernameRef = current.username ? db.collection("usernames").doc(current.username) : null;
      const username = usernameRef ? await transaction.get(usernameRef) : null;
      transaction.delete(profileRef);
      if (username?.exists && username.data().uid === uid) transaction.delete(usernameRef);
      return true;
    });
    if (deleted) removed++;
  }
  if (removed) console.info("[registration] Removed expired pending accounts.", { count: removed });
  return removed;
}

function startPendingRegistrationCleanup() {
  if (!env.runtime.supabaseAdminReady) return { stop: () => {} };
  void purgeExpiredPendingRegistrations().catch((error) => {
    console.warn("[registration] Pending account cleanup failed.", { error: error.message });
  });
  const timer = setInterval(() => {
    void purgeExpiredPendingRegistrations().catch((error) => {
      console.warn("[registration] Pending account cleanup failed.", { error: error.message });
    });
  }, CLEANUP_INTERVAL_MS);
  timer.unref();
  return timer;
}

module.exports = { purgeExpiredPendingRegistrations, startPendingRegistrationCleanup };
