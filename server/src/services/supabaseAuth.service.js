const { env } = require("../config/env");
const { ApiError } = require("../utils/ApiError");

function authHeaders({ admin = false, accessToken = "" } = {}) {
  const apiKey = admin ? env.supabase.serviceRoleKey : env.supabase.anonKey;
  if (!env.supabase.url || !apiKey) {
    throw new ApiError(503, admin
      ? "Supabase Auth administration is not configured on the backend."
      : "Supabase Auth is not configured on the backend.");
  }
  return {
    apikey: apiKey,
    Authorization: `Bearer ${accessToken || apiKey}`,
    "Content-Type": "application/json",
  };
}

async function authRequest(path, { method = "GET", body, admin = false, accessToken = "" } = {}) {
  let response;
  try {
    response = await fetch(`${env.supabase.url}/auth/v1${path}`, {
      method,
      headers: authHeaders({ admin, accessToken }),
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(10000),
    });
  } catch (_error) {
    throw new ApiError(503, "Supabase Auth could not be reached right now.", { code: "SUPABASE_AUTH_UNAVAILABLE" });
  }
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const code = String(payload?.code || payload?.error_code || payload?.error || "");
    const message = String(payload?.msg || payload?.message || "");
    const providerError = Object.fromEntries(
      ["error", "error_code", "code", "error_description", "msg", "message", "hint"]
        .filter((key) => typeof payload?.[key] === "string" && payload[key].trim())
        .map((key) => [key, payload[key].replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g, "[redacted-email]").slice(0, 300)]),
    );
    console.error("[supabase-auth] Auth request failed.", {
      method,
      status: response.status,
      code: code || "SUPABASE_AUTH_REQUEST_FAILED",
      providerError,
    });
    const authFailure = response.status === 400 || response.status === 401 || response.status === 403;
    throw new ApiError(authFailure ? 400 : response.status >= 500 ? 503 : response.status,
      message || "Supabase Auth request failed.", {
        code: code || "SUPABASE_AUTH_REQUEST_FAILED",
        providerStatus: response.status,
      });
  }
  return payload;
}

async function signInWithSupabasePassword(email, password) {
  try {
    const session = await authRequest("/token?grant_type=password", {
      method: "POST", body: { email, password },
    });
    if (!session?.access_token || !session?.user?.id) {
      throw new ApiError(503, "Supabase Auth returned an incomplete session.");
    }
    return session;
  } catch (error) {
    const code = String(error.details?.code || "").toLowerCase();
    if (["invalid_credentials", "invalid_grant", "user_not_found"].includes(code)) {
      throw new ApiError(401, "Invalid email, username, or password.", {
        code: "INVALID_LOGIN_CREDENTIALS", supabaseCode: "INVALID_LOGIN_CREDENTIALS",
      });
    }
    if (code === "email_not_confirmed") {
      throw new ApiError(403, "Verify your email using the activation link before signing in.", { code: "EMAIL_VERIFICATION_REQUIRED" });
    }
    if (code === "user_banned") {
      throw new ApiError(403, "This account is blocked from signing in.", { code: "ACCOUNT_BLOCKED" });
    }
    if ([401, 403, 404].includes(error.details?.providerStatus)) {
      throw new ApiError(503, "Supabase password authentication is unavailable. Contact the clinic if this persists.", {
        code: "SUPABASE_AUTH_UNAVAILABLE",
      });
    }
    throw error;
  }
}

async function findSupabaseUserByEmail(email) {
  const normalized = String(email || "").trim().toLowerCase();
  if (!normalized) return null;
  for (let page = 1; page <= 1000; page += 1) {
    const payload = await authRequest(`/admin/users?page=${page}&per_page=100&filter=${encodeURIComponent(normalized)}`, { admin: true });
    const users = Array.isArray(payload?.users) ? payload.users : [];
    const match = users.find((user) => String(user.email || "").trim().toLowerCase() === normalized);
    if (match) return match;
    if (users.length < 100) return null;
  }
  throw new ApiError(503, "Could not complete the Supabase duplicate-account check.", { code: "SUPABASE_USER_LOOKUP_INCOMPLETE" });
}

async function createSupabaseSessionForUser(email, expectedUserId) {
  if (!expectedUserId) throw new ApiError(403, "A linked Supabase identity is required.", { code: "AUTH_IDENTITY_LINK_REQUIRED" });
  const identity = await getSupabaseUserById(expectedUserId);
  if (identity?.id !== expectedUserId || String(identity.email || "").trim().toLowerCase() !== String(email).trim().toLowerCase()) {
    throw new ApiError(403, "The OTP account no longer matches its Supabase identity.", { code: "AUTH_IDENTITY_MISMATCH" });
  }
  if (!identity.email_confirmed_at) {
    throw new ApiError(403, "Verify your email before completing sign-in.", { code: "EMAIL_VERIFICATION_REQUIRED" });
  }
  const generated = await authRequest("/admin/generate_link", {
    method: "POST", admin: true, body: { type: "magiclink", email },
  });
  const tokenHash = generated?.hashed_token || generated?.properties?.hashed_token;
  if (!tokenHash) throw new ApiError(503, "Supabase Auth did not generate a session challenge.");
  const session = await authRequest("/verify", {
    method: "POST", body: { type: "magiclink", token_hash: tokenHash },
  });
  if (!session?.access_token || !session?.user?.id) {
    throw new ApiError(503, "Supabase Auth did not return a complete session.");
  }
  if (session.user.id !== expectedUserId) throw new ApiError(403, "The OTP session identity changed.", { code: "AUTH_IDENTITY_MISMATCH" });
  return session;
}

async function generateSupabaseRecoveryToken(email) {
  const generated = await authRequest("/admin/generate_link", {
    method: "POST", admin: true, body: { type: "recovery", email },
  });
  const tokenHash = generated?.hashed_token || generated?.properties?.hashed_token;
  if (!tokenHash) throw new ApiError(503, "Supabase Auth did not generate a password reset challenge.");
  return { tokenHash, user: generated.user || null };
}

async function createSupabaseUser({ email, password, userMetadata = {}, emailConfirmed = false }) {
  return authRequest("/admin/users", {
    method: "POST", admin: true,
    body: { email, password, email_confirm: emailConfirmed, user_metadata: userMetadata },
  });
}

async function getSupabaseUserById(userId) {
  return authRequest(`/admin/users/${encodeURIComponent(userId)}`, { admin: true });
}

async function deleteSupabaseUser(userId) {
  return authRequest(`/admin/users/${encodeURIComponent(userId)}`, { method: "DELETE", admin: true });
}

async function updateSupabaseUser(userId, updates = {}) {
  return authRequest(`/admin/users/${encodeURIComponent(userId)}`, { method: "PUT", admin: true, body: updates });
}

async function generateSupabaseEmailLink({ email, type, password, userMetadata = {} }) {
  const generated = await authRequest("/admin/generate_link", {
    method: "POST", admin: true,
    // This is the REST API, not the JS SDK: metadata belongs at top-level data.
    body: { type, email, ...(password ? { password } : {}), data: userMetadata },
  });
  const tokenHash = generated?.hashed_token || generated?.properties?.hashed_token;
  if (!tokenHash) throw new ApiError(503, "Supabase Auth did not generate an email verification challenge.");
  const user = generated.user || generated.data?.user || (generated.id ? generated : null);
  return { tokenHash, user: user || null, actionLink: generated.action_link || generated.properties?.action_link || "",
    emailOtp: generated.email_otp || generated.properties?.email_otp || "" };
}

async function verifySupabaseEmailCode(email, token) {
  return authRequest("/verify", { method: "POST", body: { email, token, type: "signup" } });
}

async function verifySupabaseEmailToken(tokenHash, type = "signup") {
  return authRequest("/verify", { method: "POST", body: { type, token_hash: tokenHash } });
}

async function verifySupabaseRecoveryToken(tokenHash) {
  return authRequest("/verify", {
    method: "POST", body: { type: "recovery", token_hash: tokenHash },
  });
}

async function updateSupabasePassword(accessToken, password) {
  return authRequest("/user", { method: "PUT", accessToken, body: { password } });
}

function decodeJwtPayload(token) {
  const encoded = String(token || "").split(".")[1];
  if (!encoded) return null;
  try { return JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")); }
  catch { return null; }
}

function isSupabaseAccessToken(token) {
  if (!env.runtime.supabaseAuthReady) return false;
  const claims = decodeJwtPayload(token);
  return claims?.iss === `${env.supabase.url}/auth/v1` && typeof claims.sub === "string";
}

async function verifySupabaseAccessToken(token) {
  if (!env.runtime.supabaseAuthReady) throw new ApiError(503, "Supabase Auth verification is not configured on the backend.");
  const claims = decodeJwtPayload(token);
  if (!claims || claims.iss !== `${env.supabase.url}/auth/v1` || typeof claims.sub !== "string") {
    throw new ApiError(401, "The Supabase session token is invalid or has expired.");
  }
  let response;
  try {
    response = await fetch(`${env.supabase.url}/auth/v1/user`, {
      headers: { apikey: env.supabase.anonKey, Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(10000),
    });
  } catch (_error) {
    throw new ApiError(503, "Supabase Auth could not be reached to verify this session.", { code: "SUPABASE_AUTH_UNAVAILABLE" });
  }
  if (response.status === 401 || response.status === 403) throw new ApiError(401, "The Supabase session token is invalid or has expired.");
  if (!response.ok) throw new ApiError(503, "Supabase Auth could not verify this session right now.", { code: "SUPABASE_AUTH_UNAVAILABLE" });
  const user = await response.json().catch(() => null);
  if (!user?.id || user.id !== claims.sub) throw new ApiError(401, "The Supabase session does not match its user identity.");
  if (!user.email_confirmed_at) throw new ApiError(403, "Verify your email before using this session.", { code: "EMAIL_VERIFICATION_REQUIRED" });
  return { ...claims, uid: user.id, sub: user.id, email: user.email || claims.email || "", supabaseUser: user };
}

module.exports = {
  authRequest,
  createSupabaseUser,
  deleteSupabaseUser,
  createSupabaseSessionForUser,
  decodeJwtPayload,
  findSupabaseUserByEmail,
  generateSupabaseRecoveryToken,
  generateSupabaseEmailLink,
  getSupabaseUserById,
  isSupabaseAccessToken,
  signInWithSupabasePassword,
  updateSupabasePassword,
  updateSupabaseUser,
  verifySupabaseEmailToken,
  verifySupabaseEmailCode,
  verifySupabaseAccessToken,
  verifySupabaseRecoveryToken,
};
