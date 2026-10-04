const { db, auth } = require("../config/firebaseAdmin");
const { ApiError } = require("../utils/ApiError");
const { getClientIp, validateAccessSecurity } = require("./registrationSecurity.service");

function violation(reason) {
  return new ApiError(401, "VPN use is prohibited. Your session ended because a VPN/proxy was detected or your IP address changed. Disable any VPN or proxy and sign in again.",
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
        reason: "ip-changed" }, { merge: true });
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
    await db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(reference);
      transaction.set(reference, { revokedBefore: Math.max(Math.floor(Date.now() / 1000), Number(snapshot.data()?.revokedBefore || 0)),
        reason: "vpn-proxy" }, { merge: true });
    });
    await terminate("vpn-proxy");
  }
  const finalViolation = await checkBinding(true);
  if (finalViolation) await terminate(finalViolation);
}

module.exports = { validateSessionSecurity };
