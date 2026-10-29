const { auth: firebaseAdminAuth } = require("../config/firebaseAdmin");
const { env } = require("../config/env");
const { verifyAccessToken } = require("../services/token.service");
const { validateSessionSecurity } = require("../services/sessionSecurity.service");
const { getUserByAuthId, getUserByUid, toPublicUser } = require("../services/user.service");
const { FRAUD_STATUSES, USER_STATUSES } = require("../constants/auth");
const { ApiError } = require("../utils/ApiError");
const { isSupabaseAccessToken, verifySupabaseAccessToken } = require("../services/supabaseAuth.service");

async function verifyFirebaseIdToken(token) {
  if (!firebaseAdminAuth || !env.runtime.firebaseAdminReady) {
    throw new ApiError(401, "This legacy Firebase session is no longer accepted. Sign in again with Supabase Auth.", { code: "LEGACY_AUTH_DISABLED" });
  }

  try {
    return await firebaseAdminAuth.verifyIdToken(token, true);
  } catch (_error) {
    if (_error?.code === "auth/id-token-revoked") {
      throw new ApiError(401, "Your session was revoked for security. Please sign in again.",
        { code: "SESSION_SECURITY_VIOLATION" });
    }
    throw new ApiError(401, "The Firebase session token is invalid or has expired.");
  }
}

function tryVerifyLegacyAccessToken(token) {
  if (!env.auth.jwtSecret) {
    return null;
  }

  try {
    return verifyAccessToken(token);
  } catch (error) {
    if (error instanceof ApiError && error.statusCode === 401) {
      return null;
    }

    throw error;
  }
}

function extractBearerToken(req) {
  const rawHeader = req.headers.authorization || "";
  const token = rawHeader.startsWith("Bearer ") ? rawHeader.slice(7).trim() : "";

  if (!token) {
    throw new ApiError(401, "Authentication token is required.");
  }

  return token;
}

async function attachAuthenticatedUser(req, token, claims, provider) {
  const userId = claims?.sub || claims?.uid || "";
  const user = provider === "supabase-auth"
    ? await getUserByAuthId(userId)
    : await getUserByUid(userId);

  if (!user) {
    throw new ApiError(401, "The authenticated user no longer exists.");
  }

  if (user.accountStatus !== USER_STATUSES.ACTIVE) {
    throw new ApiError(403, `This account is ${user.accountStatus}.`);
  }

  if ([FRAUD_STATUSES.SUSPENDED, FRAUD_STATUSES.BANNED].includes(user.fraudStatus)) {
    throw new ApiError(403, `This account is ${user.fraudStatus} for security review.`);
  }

  if (provider === "server-jwt") {
    if (
      claims.role !== user.role ||
      claims.email !== user.email ||
      claims.accountStatus !== user.accountStatus
    ) {
      throw new ApiError(401, "The session no longer matches the stored account role.");
    }
  } else if (
    typeof claims?.email === "string" &&
    claims.email.trim().toLowerCase() !== user.email
  ) {
    throw new ApiError(401, "The authenticated session no longer matches the stored account email.");
  }

  req.auth = {
    token,
    user: toPublicUser(user),
    claims,
    provider,
  };
}

async function verifyToken(req, _res, next) {
  try {
    const token = extractBearerToken(req);
    const legacyPayload = tryVerifyLegacyAccessToken(token);

    if (legacyPayload) {
      await attachAuthenticatedUser(req, token, legacyPayload, "server-jwt");
      await validateSessionSecurity(req);
      return next();
    }

    const usesSupabase = isSupabaseAccessToken(token);
    const claims = usesSupabase
      ? await verifySupabaseAccessToken(token)
      : await verifyFirebaseIdToken(token);
    await attachAuthenticatedUser(req, token, claims, usesSupabase ? "supabase-auth" : "firebase-id-token");
    await validateSessionSecurity(req);
    return next();
  } catch (error) {
    return next(error);
  }
}

async function verifySessionToken(req, _res, next) {
  return verifyToken(req, _res, next);
}

module.exports = {
  authenticate: verifyToken,
  verifySessionToken,
  verifyToken,
};
