const crypto = require("node:crypto");
const net = require("node:net");
const { db, auth } = require("../config/firebaseAdmin");
const { env } = require("../config/env");
const { ApiError } = require("../utils/ApiError");

const SESSION_CONNECTIONS_COLLECTION = "sessionConnections";
const SECURITY_COLLECTION = "sessionSecurity";
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const LOOKUP_TIMEOUT_MS = 5000;
const VPN_BLOCK_MESSAGE = "Blocked VPN IP address";
const SESSION_TERMINATED_MESSAGE = "Your session was terminated because your IP address changed...";

function normalizeIp(value = "") {
  const ip = String(value || "").trim().replace(/^::ffff:/, "");
  return ip.includes("%") ? ip.split("%")[0] : ip;
}

function isPrivateIpv4(ip) {
  const parts = ip.split(".").map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return false;
  }

  const [a, b] = parts;
  return a === 10 || a === 127 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)
    || (a === 169 && b === 254) || a === 0;
}

function isPrivateIpv6(ip) {
  const normalized = ip.toLowerCase();
  return normalized === "::1" || normalized.startsWith("fc") || normalized.startsWith("fd")
    || normalized.startsWith("fe80:");
}

function shouldLookupIp(ip = "") {
  const version = net.isIP(ip);
  if (!version) return false;
  return version === 4 ? !isPrivateIpv4(ip) : !isPrivateIpv6(ip);
}

function getClientIp(req) {
  return normalizeIp(req.ip || req.connection?.remoteAddress || req.socket?.remoteAddress || "");
}

function buildProviderUrl(ip) {
  const template = env.security.geoLookupUrl || "https://api.ipapi.is/?q={ip}&key={api_key}";
  const withKey = template.replaceAll("{api_key}", encodeURIComponent(env.security.geoLookupApiKey || ""));
  if (withKey.includes("{ip}")) return withKey.replaceAll("{ip}", encodeURIComponent(ip));
  const url = new URL(withKey);
  url.searchParams.set("q", ip);
  if (env.security.geoLookupApiKey && !url.searchParams.has("key")) {
    url.searchParams.set("key", env.security.geoLookupApiKey);
  }
  return url.toString();
}

function readBooleanFlag(value) {
  if (value === true || value === 1) return true;
  if (typeof value === "string") return ["true", "1", "yes"].includes(value.trim().toLowerCase());
  return false;
}

function getProviderCountries(data) {
  return [data?.location?.country, data?.location?.country_code, data?.country, data?.country_code]
    .filter((value) => typeof value === "string" && value.trim())
    .map((value) => value.trim().toLowerCase());
}

function isBlockedProviderResult(data) {
  const countries = getProviderCountries(data);
  if (!countries.length || countries.some((country) => !["philippines", "ph", "phl"].includes(country))) {
    return true;
  }
  const containers = [data, data?.security, data?.risk, data?.privacy, data?.threat].filter(Boolean);
  return containers.some((item) => ["is_vpn", "is_proxy", "is_tor", "is_hosting", "vpn", "proxy", "tor", "hosting"]
    .some((key) => readBooleanFlag(item?.[key])));
}

async function lookupIpSecurity(ip) {
  if (!shouldLookupIp(ip)) return { checked: false, blocked: false };
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), LOOKUP_TIMEOUT_MS);
  try {
    const response = await fetch(buildProviderUrl(ip), { signal: controller.signal });
    if (!response.ok) {
      console.warn("[session-security] IP provider returned a non-OK response.", {
        ip,
        status: response.status,
      });
      return { checked: false, blocked: false };
    }
    const data = await response.json();
    const blocked = isBlockedProviderResult(data);
    if (blocked) {
      console.warn("[session-security] Connection blocked.", {
        ip, countries: getProviderCountries(data), blocked: true,
      });
    }
    return { checked: true, blocked, data };
  } catch (error) {
    console.warn("[session-security] IP provider lookup failed.", {
      ip,
      error: error instanceof Error ? error.message : String(error || "Unknown error"),
    });
    return { checked: false, blocked: false };
  } finally {
    clearTimeout(timeout);
  }
}

async function revokeUserSession(uid, details = {}) {
  const now = Date.now();
  await db.collection(SECURITY_COLLECTION).doc(uid).set({
    revocationPending: true,
    revokedBefore: Math.floor(now / 1000),
    reason: details.reason || "session-security",
    lastViolationIp: details.ip || "",
    updatedAt: new Date(now),
  }, { merge: true });
  try {
    await auth.revokeRefreshTokens(uid);
    await db.collection(SECURITY_COLLECTION).doc(uid).set({
      revocationPending: false,
      revokedBefore: Math.floor(Date.now() / 1000),
      updatedAt: new Date(),
    }, { merge: true });
  } catch (error) {
    console.warn("[session-security] Firebase token revocation failed.", {
      uid,
      error: error instanceof Error ? error.message : String(error || "Unknown error"),
    });
  }
}

function getTokenIssuedAt(claims = {}) {
  const value = Number(claims.iat || claims.auth_time || 0);
  return Number.isFinite(value) ? value : 0;
}

async function assertTokenNotRevoked(uid, claims = {}) {
  const snapshot = await db.collection(SECURITY_COLLECTION).doc(uid).get();
  const revokedBefore = Number(snapshot.data()?.revokedBefore || 0);
  if (revokedBefore && getTokenIssuedAt(claims) <= revokedBefore) {
    throw new ApiError(401, "Your session was revoked for security. Please sign in again.", {
      code: "SESSION_SECURITY_VIOLATION",
    });
  }
}

async function validateAccessSecurity(req, options = {}) {
  const ip = getClientIp(req);
  const result = await lookupIpSecurity(ip);
  if (result.blocked) {
    throw new ApiError(403, options.message || VPN_BLOCK_MESSAGE, {
      code: "SESSION_SECURITY_VIOLATION",
      ip,
    });
  }
  return { ip, checked: result.checked };
}

async function createFreshSessionBinding(user, req) {
  const security = await validateAccessSecurity(req, { message: VPN_BLOCK_MESSAGE });
  const sessionId = crypto.randomUUID();
  await db.collection(SESSION_CONNECTIONS_COLLECTION).doc(sessionId).set({
    uid: user.uid,
    ip: security.ip,
    createdAt: new Date(),
    updatedAt: new Date(),
    expiresAt: new Date(Date.now() + SESSION_TTL_MS),
  });
  return { ip: security.ip, sessionId };
}

async function validateSessionSecurity(req) {
  const user = req.auth?.user;
  const claims = req.auth?.claims || {};
  if (!user?.uid) return;

  await assertTokenNotRevoked(user.uid, claims);
  let security;
  try {
    security = await validateAccessSecurity(req, { message: SESSION_TERMINATED_MESSAGE });
  } catch (error) {
    if (error instanceof ApiError && error.details?.code === "SESSION_SECURITY_VIOLATION") {
      await revokeUserSession(user.uid, { ip: error.details.ip || getClientIp(req), reason: "blocked-network" });
    }
    throw error;
  }
  const sessionId = typeof claims.sessionId === "string" ? claims.sessionId : "";

  if (!sessionId) return;

  const reference = db.collection(SESSION_CONNECTIONS_COLLECTION).doc(sessionId);
  const snapshot = await reference.get();
  const connection = snapshot.data() || {};
  if (connection.uid && connection.uid !== user.uid) {
    await revokeUserSession(user.uid, { ip: security.ip, reason: "session-owner-mismatch" });
    throw new ApiError(401, SESSION_TERMINATED_MESSAGE, { code: "SESSION_SECURITY_VIOLATION" });
  }

  if (connection.ip !== security.ip) {
    await reference.set({
      uid: user.uid,
      ip: security.ip,
      updatedAt: new Date(),
      expiresAt: new Date(Date.now() + SESSION_TTL_MS),
    }, { merge: true });
  }
}

// Login-only recovery for historic revocations still enforced by Firebase and Firestore rules.
async function waitForFreshSession(uid, { now = Date.now, sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)) } = {}) {
  const reference = db.collection(SECURITY_COLLECTION).doc(uid);
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

module.exports = {
  createFreshSessionBinding,
  getClientIp,
  validateAccessSecurity,
  validateSessionSecurity,
  waitForFreshSession,
};
