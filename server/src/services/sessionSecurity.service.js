const { db } = require("../config/firebaseAdmin");
const { ApiError } = require("../utils/ApiError");
const { validateAccessSecurity } = require("./registrationSecurity.service");

const SECURITY_MESSAGE = "Your session ended because a VPN, proxy, or connection outside the Philippines was detected. Disable your VPN and use a Philippine connection before signing in again.";

function terminatedSessionError() {
  return new ApiError(401, SECURITY_MESSAGE, { code: "SESSION_SECURITY_VIOLATION" });
}

async function validateSessionSecurity(req) {
  const { user, claims, provider } = req.auth;
  const reference = db.collection("sessionSecurity").doc(user.uid);
  const snapshot = await reference.get();
  const startedAt = provider === "firebase-id-token" ? claims.auth_time : claims.iat;
  if (snapshot.exists && Number(startedAt || 0) <= snapshot.data().revokedBefore) {
    throw terminatedSessionError();
  }

  try {
    await validateAccessSecurity(req);
  } catch (error) {
    if (!(error instanceof ApiError) || error.statusCode !== 403) throw error;
    // Persist revocation so switching back to an allowed IP cannot revive old tokens.
    await reference.set({ revokedBefore: Math.floor(Date.now() / 1000) }, { merge: true });
    throw terminatedSessionError();
  }
}

module.exports = { validateSessionSecurity };
