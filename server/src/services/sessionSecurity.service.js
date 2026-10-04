const { db, auth } = require("../config/firebaseAdmin");
const { ApiError } = require("../utils/ApiError");
const { getClientIp, validateAccessSecurity } = require("./registrationSecurity.service");

const SECURITY_MESSAGE = "Your session ended because your IP address changed or a VPN/proxy connection was detected. Disable your VPN and sign in again using a Philippine connection.";
const UNVERIFIED_MESSAGE = "Your session ended because the security of your connection could not be verified. Please reconnect and sign in again.";

function terminatedSessionError(reason) {
  return new ApiError(401, reason === "unverified" ? UNVERIFIED_MESSAGE : SECURITY_MESSAGE,
    { code: "SESSION_SECURITY_VIOLATION", reason });
}

async function validateSessionSecurity(req) {
  const { user, claims, provider } = req.auth;
  const reference = db.collection("sessionSecurity").doc(user.uid);
  const startedAt = Number(provider === "firebase-id-token" ? claims.auth_time : claims.iat);
  if (!Number.isFinite(startedAt) || startedAt <= 0) throw terminatedSessionError("invalid-session");
  const ip = getClientIp(req);
  const connection = db.collection("sessionConnections").doc(`${user.uid}-${provider}-${startedAt}`);

  const checkBinding = async (bind = false) => db.runTransaction(async (transaction) => {
    const [snapshot, binding] = await Promise.all([transaction.get(reference), transaction.get(connection)]);
    const previous = snapshot.exists ? snapshot.data() : {};
    if (startedAt <= Number(previous.revokedBefore || 0)) return previous.reason === "unverified" ? "unverified" : "revoked";
    const expectedIp = binding.exists ? binding.data().ip : claims.connectionIp;
    if (expectedIp && expectedIp !== ip) {
      transaction.set(reference, { revokedBefore: Math.floor(Date.now() / 1000), reason: "ip-changed" }, { merge: true });
      return "ip-changed";
    }
    if (bind && !binding.exists) {
      transaction.set(connection, { uid: user.uid, ip, startedAt, provider,
        expiresAt: new Date(Date.now() + 15 * 24 * 60 * 60 * 1000) });
    }
    return "";
  });
  const revokeRefreshTokens = async () => {
    try { await auth.revokeRefreshTokens(user.uid); }
    catch (error) { console.warn("[session-security] Refresh-token revocation failed; persistent session revocation remains active.", error); }
  };
  const existingViolation = await checkBinding();
  if (existingViolation) {
    if (existingViolation === "ip-changed") await revokeRefreshTokens();
    throw terminatedSessionError(existingViolation);
  }

  try {
    await validateAccessSecurity(req);
  } catch (error) {
    if (!(error instanceof ApiError) || ![403, 503].includes(error.statusCode)) throw error;
    // Persist revocation so switching back to an allowed IP cannot revive old tokens.
    const reason = error.statusCode === 503 ? "unverified" : "vpn-proxy";
    await db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(reference);
      const revokedBefore = Math.max(Math.floor(Date.now() / 1000), Number(snapshot.data()?.revokedBefore || 0));
      transaction.set(reference, { revokedBefore, reason }, { merge: true });
    });
    await revokeRefreshTokens();
    throw terminatedSessionError(reason);
  }
  const finalViolation = await checkBinding(true);
  if (finalViolation) {
    if (finalViolation === "ip-changed") await revokeRefreshTokens();
    throw terminatedSessionError(finalViolation);
  }
}

module.exports = { validateSessionSecurity };
