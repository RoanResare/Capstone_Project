const { auth: firebaseAdminAuth } = require("../config/firebaseAdmin");
const { env } = require("../config/env");
const { verifyAccessToken } = require("../services/token.service");
const { getUserByUid, toPublicUser } = require("../services/user.service");
const { USER_STATUSES } = require("../constants/auth");
const { ApiError } = require("../utils/ApiError");

function buildFirebaseSetupError() {
  const missingVariables = [];

  if (!env.firebase.projectId) {
    missingVariables.push("FIREBASE_PROJECT_ID");
  }

  if (!env.firebase.clientEmail) {
    missingVariables.push("FIREBASE_CLIENT_EMAIL");
  }

  if (!env.firebase.privateKey) {
    missingVariables.push("FIREBASE_PRIVATE_KEY");
  }

  return new ApiError(
    503,
    `Authentication setup is incomplete. Missing environment variables: ${missingVariables.join(", ")}.`,
    {
      missingVariables,
    },
  );
}

async function verifyFirebaseIdToken(token) {
  if (!firebaseAdminAuth || !env.runtime.firebaseAdminReady) {
    throw buildFirebaseSetupError();
  }

  try {
    return await firebaseAdminAuth.verifyIdToken(token);
  } catch (_error) {
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
  const user = await getUserByUid(userId);

  if (!user) {
    throw new ApiError(401, "The authenticated user no longer exists.");
  }

  if (user.accountStatus !== USER_STATUSES.ACTIVE) {
    throw new ApiError(403, `This account is ${user.accountStatus}.`);
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
    throw new ApiError(401, "The Firebase session no longer matches the stored account email.");
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
      return next();
    }

    const firebasePayload = await verifyFirebaseIdToken(token);
    await attachAuthenticatedUser(req, token, firebasePayload, "firebase-id-token");
    return next();
  } catch (error) {
    return next(error);
  }
}

async function verifySessionToken(req, _res, next) {
  try {
    const token = extractBearerToken(req);
    const legacyPayload = verifyAccessToken(token);
    await attachAuthenticatedUser(req, token, legacyPayload, "server-jwt");
    return next();
  } catch (error) {
    return next(error);
  }
}

module.exports = {
  authenticate: verifyToken,
  verifySessionToken,
  verifyToken,
};
