const { db, auth } = require("../config/firebaseAdmin");
const { ApiError } = require("../utils/ApiError");
const { getClientIp, validateAccessSecurity } = require("./registrationSecurity.service");

function violation(reason) {
  const message = reason === "vpn-proxy"
    ? "Your session was terminated because a VPN or proxy was detected. VPN use is prohibited. Disable it and sign in again."
    : reason === "ip-changed"
      ? "Your session was terminated because your IP address changed. VPN use is prohibited. Return to your normal network and sign in again."
      : "This session has ended for security. Return to your normal network and sign in again.";
  return new ApiError(401, message,
    { code: "SESSION_SECURITY_VIOLATION", reason });
}

async function validateSessionSecurity(req) {
  const { user, claims, provider } = req.auth;
  const startedAt = Number(provider === "firebase-id-token" ? claims.auth_time : claims.iat);
  if (!Number.isFinite(startedAt) || startedAt <= 0) {
    throw new ApiError(401, "The session is invalid. Please sign in again.",
      { code: "SESSION_SECURITY_VIOLATION", reason: "invalid-session" });
  }
  const ip = getClientIp(req);
  const reference = db.collection("sessionSecurity").doc(user.uid);
  const connection = db.collection("sessionConnections").doc(`${user.uid}-${provider}-${startedAt}`);
  const checkBinding = (bind = false) => db.runTransaction(async (transaction) => {
    const [snapshot, binding] = await Promise.all([transaction.get(reference), transaction.get(connection)]);
    const previous = snapshot.data() || {};
    if (startedAt <= Number(previous.revokedBefore || 0)) return "revoked";
    const expectedIp = binding.exists ? binding.data().ip : claims.connectionIp;
    if (expectedIp && expectedIp !== ip) {
      transaction.set(reference, { revokedBefore: Math.max(Math.floor(Date.now() / 1000), Number(previous.revokedBefore || 0)),
        reason: "ip-changed", revocationPending: true }, { merge: true });
      return "ip-changed";
    }
    if (bind && !binding.exists) {
      transaction.set(connection, { uid: user.uid, ip, startedAt, provider,
        expiresAt: new Date(Date.now() + 15 * 24 * 60 * 60 * 1000) });
    }
    return "";
  });
  const terminate = async (reason) => {
    if (reason !== "revoked") {
      try { await auth.revokeRefreshTokens(user.uid); }
      catch (error) { console.warn("[session-security] Refresh-token revocation failed; persisted revocation remains active.", error); }
      await db.runTransaction(async (transaction) => {
        const snapshot = await transaction.get(reference);
        if (!snapshot.data()?.revocationPending) return;
        transaction.set(reference, { revocationPending: false,
          revokedBefore: Math.max(Math.floor(Date.now() / 1000), Number(snapshot.data()?.revokedBefore || 0)) }, { merge: true });
      });
    }
    throw violation(reason);
  };
  const existingViolation = await checkBinding();
  if (existingViolation) await terminate(existingViolation);
  try {
    await validateAccessSecurity(req);
  } catch (error) {
    if (!(error instanceof ApiError) || error.statusCode !== 403) throw error;
    // Persist revocation before returning an error so old tokens cannot be replayed.
    const newlyRevoked = await db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(reference);
      if (startedAt <= Number(snapshot.data()?.revokedBefore || 0)) return false;
      transaction.set(reference, { revokedBefore: Math.max(Math.floor(Date.now() / 1000), Number(snapshot.data()?.revokedBefore || 0)),
        reason: "vpn-proxy", revocationPending: true }, { merge: true });
      return true;
    });
    await terminate(newlyRevoked ? "vpn-proxy" : "revoked");
  }
  const finalViolation = await checkBinding(true);
  if (finalViolation) await terminate(finalViolation);
}

async function waitForFreshSession(uid, { now = Date.now, sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)) } = {}) {
  const reference = db.collection("sessionSecurity").doc(uid);
  const deadline = now() + 10000;
  let snapshot = await reference.get();
  while (snapshot.data()?.revocationPending) {
    const cutoff = Number(snapshot.data().revokedBefore || 0);
    // Recover a pending marker left behind by a crashed/restarted server, without reviving old tokens.
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

module.exports = { validateSessionSecurity, waitForFreshSession };
