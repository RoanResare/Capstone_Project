const { db, auth } = require("../config/firebaseAdmin");
const { ApiError } = require("../utils/ApiError");

// Login-only recovery for historic revocations still enforced by Firebase and Firestore rules.
async function waitForFreshSession(uid, { now = Date.now, sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)) } = {}) {
  const reference = db.collection("sessionSecurity").doc(uid);
  const deadline = now() + 10000;
  let snapshot = await reference.get();
  while (snapshot.data()?.revocationPending) {
    const cutoff = Number(snapshot.data().revokedBefore || 0);
    if (now() - cutoff * 1000 >= 30000) {
      try { await auth.revokeRefreshTokens(uid); }
      catch (_error) { throw new ApiError(503, "Unable to reset the previous session right now. Please try again shortly."); }
      await db.runTransaction(async (transaction) => {
        const latest = await transaction.get(reference);
        if (latest.data()?.revocationPending && Number(latest.data().revokedBefore || 0) === cutoff) {
          transaction.set(reference, { revocationPending: false,
            revokedBefore: Math.max(Math.floor(now() / 1000), cutoff) }, { merge: true });
        }
      });
      snapshot = await reference.get();
      continue;
    }
    if (now() >= deadline) throw new ApiError(503, "The previous session is still ending. Please try signing in again in a moment.");
    await sleep(100);
    snapshot = await reference.get();
  }
  // Firebase auth_time and JWT iat use seconds. A fresh login must clear the old cutoff.
  const remainingMs = (Number(snapshot.data()?.revokedBefore || 0) + 1) * 1000 - now();
  if (remainingMs > 0) await sleep(remainingMs);
}

module.exports = { waitForFreshSession };
