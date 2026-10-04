const { db } = require("../config/firebaseAdmin");
const { ApiError } = require("../utils/ApiError");

// Enforce persisted revocation without rechecking the user's IP or connection.
async function validateSessionSecurity(req) {
  const { user, claims, provider } = req.auth;
  const startedAt = Number(provider === "firebase-id-token" ? claims.auth_time : claims.iat);
  if (!Number.isFinite(startedAt) || startedAt <= 0) {
    throw new ApiError(401, "The session is invalid. Please sign in again.",
      { code: "SESSION_SECURITY_VIOLATION", reason: "invalid-session" });
  }
  const snapshot = await db.collection("sessionSecurity").doc(user.uid).get();
  if (startedAt <= Number(snapshot.data()?.revokedBefore || 0)) {
    throw new ApiError(401, "Your session was revoked for security. Please sign in again.",
      { code: "SESSION_SECURITY_VIOLATION", reason: "revoked" });
  }
}

module.exports = { validateSessionSecurity };
