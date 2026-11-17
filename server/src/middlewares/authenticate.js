const { env } = require("../config/env");
const { verifyAccessToken } = require("../services/token.service");
const { validateSessionSecurity } = require("../services/sessionSecurity.service");
const { getUserByAuthId, getUserByUid, toPublicUser } = require("../services/user.service");
const { FRAUD_STATUSES, USER_STATUSES } = require("../constants/auth");
const { ApiError } = require("../utils/ApiError");
const { isSupabaseAccessToken, verifySupabaseAccessToken } = require("../services/supabaseAuth.service");

function tryVerifyServerAccessToken(token) {
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
    const serverPayload = tryVerifyServerAccessToken(token);

    if (serverPayload) {
      await attachAuthenticatedUser(req, token, serverPayload, "server-jwt");
      await validateSessionSecurity(req);
      return next();
    }

    if (!isSupabaseAccessToken(token)) {
      throw new ApiError(401, "A valid Supabase session token is required.");
    }
    const claims = await verifySupabaseAccessToken(token);
    await attachAuthenticatedUser(req, token, claims, "supabase-auth");
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
