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
const BLOCKED_NETWORK_NAMES = [
  /\b(?:proton (?:technologies )?ag|proton ?vpn|windscribe|privado networks|privado ?vpn|tunnel ?bear)\b/,
  /\b(?:hetzner|leaseweb|digitalocean|digital ocean|vultr|ovhcloud|ovh sas|amazon data services|amazon web services|microsoft azure)\b/,
];
const blockedNetworks = new net.BlockList();
for (const cidr of (env.security.blockedNetworkCidrs || "").split(",").map((value) => value.trim()).filter(Boolean)) {
  const [address, prefix, extra] = cidr.split("/");
  const version = net.isIP(address);
  const bits = prefix === undefined ? (version === 4 ? 32 : 128) : Number(prefix);
  if (!version || extra !== undefined || (prefix !== undefined && !/^\d+$/.test(prefix)) || !Number.isInteger(bits) || bits < 0 || bits > (version === 4 ? 32 : 128)) {
    throw new Error("SESSION_BLOCKED_NETWORK_CIDRS contains an invalid IP address or CIDR.");
  }
  blockedNetworks.addSubnet(address, bits, version === 4 ? "ipv4" : "ipv6");
}
let warnedAnonymousResponse = false;

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

function getProviderBlockReason(data) {
  const containers = [data, data?.security, data?.risk, data?.privacy, data?.threat].filter(Boolean);
  const flagged = containers.some((item) => ["is_vpn", "is_proxy", "is_tor", "is_hosting", "is_datacenter", "vpn", "proxy", "tor", "hosting", "datacenter"]
    .some((key) => readBooleanFlag(item?.[key])));
  if (flagged) return "explicit-network-flag";
  const egressType = String(data?.egress_service?.type || "").trim().toLowerCase();
  if (["private_relay", "secure_web_gateway"].includes(egressType)) return "proxy-egress-service";
  const types = [data?.company?.type, data?.asn?.type];
  if (types.some((type) => typeof type === "string" && type.trim().toLowerCase() === "hosting")) {
    return "hosting-network-type";
  }
  const names = [data?.company, data?.company?.name, data?.company_name,
    data?.asn, data?.asn?.org, data?.asn?.name, data?.asn_org, data?.asn_name]
    .filter((value) => typeof value === "string")
    .map((value) => value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim());
  if (names.some((name) => BLOCKED_NETWORK_NAMES.some((pattern) => pattern.test(name)))) {
    return "vpn-or-hosting-provider-name";
  }
  return "";
}

async function lookupIpSecurity(ip) {
  if (!shouldLookupIp(ip)) return { checked: false, blocked: false };
  if (blockedNetworks.check(ip, net.isIP(ip) === 4 ? "ipv4" : "ipv6")) {
    console.warn("[session-security] Connection blocked.", { ip, blocked: true, reason: "configured-network-range" });
    return { checked: true, blocked: true };
  }
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
    if (typeof data?.docs === "string" && data.docs.startsWith("https://ipapi.is/free-tier.html") && !warnedAnonymousResponse) {
      warnedAnonymousResponse = true;
      console.warn("[session-security] Anonymous ipapi.is response lacks threat detection. Configure FRAUD_GEO_LOOKUP_API_KEY on the backend.");
    }
    const reason = getProviderBlockReason(data);
    const blocked = Boolean(reason);
    if (blocked) {
      console.warn("[session-security] Connection blocked.", {
        ip, blocked: true, reason,
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

async function revokeUserSession(uid, details = {}, claims = {}) {
  const now = Date.now();
  const reference = db.collection(SECURITY_COLLECTION).doc(uid);
  const cutoff = Math.max(Math.floor(now / 1000), getTokenIssuedAt(claims));
  // Only the first violation revokes this token; late requests cannot revoke a fresh login.
  const started = await db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(reference);
    const previousCutoff = Number(snapshot.data()?.revokedBefore || 0);
    if (snapshot.data()?.revocationPending || (previousCutoff && getTokenIssuedAt(claims) <= previousCutoff)) return false;
    transaction.set(reference, {
      revocationPending: true, revokedBefore: cutoff,
      reason: details.reason || "session-security", lastViolationIp: details.ip || "",
      updatedAt: new Date(now),
    }, { merge: true });
    return true;
  });
  if (!started) return;
  try {
    await auth.revokeRefreshTokens(uid);
    await db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(reference);
      if (snapshot.data()?.revocationPending && Number(snapshot.data()?.revokedBefore || 0) === cutoff) {
        transaction.set(reference, {
          revocationPending: false, revokedBefore: Math.max(cutoff, Math.floor(Date.now() / 1000)),
          updatedAt: new Date(),
        }, { merge: true });
      }
    });
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
      await revokeUserSession(user.uid, { ip: error.details.ip || getClientIp(req), reason: "blocked-network" }, claims);
    }
    throw error;
  }
  await assertTokenNotRevoked(user.uid, claims);
  const sessionId = typeof claims.sessionId === "string" ? claims.sessionId : "";

  if (!sessionId) return;

  const reference = db.collection(SESSION_CONNECTIONS_COLLECTION).doc(sessionId);
  const snapshot = await reference.get();
  const connection = snapshot.data() || {};
  if (connection.uid && connection.uid !== user.uid) {
    await revokeUserSession(user.uid, { ip: security.ip, reason: "session-owner-mismatch" }, claims);
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
