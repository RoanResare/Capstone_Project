const { createHash, randomBytes, timingSafeEqual } = require("node:crypto");
const { db } = require("../config/postgresDatabase");
const { env } = require("../config/env");

const TRUSTED_DEVICE_TTL_MS = 14 * 24 * 60 * 60 * 1000;
const ROLES = new Set(["admin", "staff"]);

function trustedDeviceCookieName(role) {
  if (!ROLES.has(role)) throw new Error("A portal role is required for trusted-device cookies.");
  return `${env.nodeEnv === "production" ? "__Host-" : ""}furfection-trusted-${role}`;
}

function cookieValue(req, role) {
  const name = trustedDeviceCookieName(role);
  const header = typeof req?.headers?.cookie === "string" ? req.headers.cookie : "";
  for (const part of header.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0 || part.slice(0, separator).trim() !== name) continue;
    try { return decodeURIComponent(part.slice(separator + 1).trim()); }
    catch { return ""; }
  }
  return "";
}

function splitCredential(value) {
  const [deviceId, secret, extra] = String(value || "").split(".");
  if (!deviceId || !secret || extra) return null;
  return { deviceId, secret };
}

function digest(secret) {
  return createHash("sha256").update(secret).digest("hex");
}

function secureCookieOptions(role, maxAgeMs) {
  const production = env.nodeEnv === "production";
  const maxAge = Math.max(0, Math.floor(maxAgeMs / 1000));
  return [
    `${trustedDeviceCookieName(role)}=`,
    "Path=/",
    "HttpOnly",
    ...(production ? ["Secure", "SameSite=None", "Partitioned"] : ["SameSite=Lax"]),
    `Max-Age=${maxAge}`,
  ];
}

function writeCookie(res, role, credential, maxAgeMs) {
  const parts = secureCookieOptions(role, maxAgeMs);
  parts[0] = `${trustedDeviceCookieName(role)}=${encodeURIComponent(credential)}`;
  res.append("Set-Cookie", parts.join("; "));
}

function clearTrustedDeviceCookie(res, role) {
  const parts = secureCookieOptions(role, 0);
  res.append("Set-Cookie", parts.join("; "));
}

async function issueTrustedDevice(user, role, res) {
  if (!ROLES.has(role) || user?.role !== role || !user?.uid) {
    throw new Error("Only the matching admin or staff account can register a trusted device.");
  }
  if (typeof user.passwordHash !== "string" || !user.passwordHash) {
    throw new Error("A password hash is required to bind trusted-device access to the account credential.");
  }
  const deviceId = randomBytes(18).toString("base64url");
  const secret = randomBytes(32).toString("base64url");
  const now = Date.now();
  const expiresAt = now + TRUSTED_DEVICE_TTL_MS;
  await db.collection("trustedDevices").doc(deviceId).set({
    userId: user.uid,
    role,
    secretHash: digest(secret),
    passwordFingerprint: digest(user.passwordHash),
    createdAt: now,
    expiresAt,
    revokedAt: 0,
    revokeReason: "",
  });
  writeCookie(res, role, `${deviceId}.${secret}`, TRUSTED_DEVICE_TTL_MS);
  return new Date(expiresAt).toISOString();
}

async function isTrustedDevice(req, user, role, res) {
  if (!ROLES.has(role) || user?.role !== role || !user?.uid) return false;
  if (user.accountStatus !== "active" || ["suspended", "banned"].includes(user.fraudStatus)) {
    clearTrustedDeviceCookie(res, role);
    return false;
  }
  const credential = splitCredential(cookieValue(req, role));
  if (!credential) return false;
  const reference = db.collection("trustedDevices").doc(credential.deviceId);
  const snapshot = await reference.get();
  const record = snapshot.data();
  const now = Date.now();
  if (!record) {
    clearTrustedDeviceCookie(res, role);
    return false;
  }
  if (record.userId !== user.uid || record.role !== role) return false;
  if (record.revokedAt) {
    clearTrustedDeviceCookie(res, role);
    return false;
  }
  if (!user.passwordHash || record.passwordFingerprint !== digest(user.passwordHash)) {
    await revokeDeviceRecord(reference, record, "password-changed");
    clearTrustedDeviceCookie(res, role);
    return false;
  }
  if (!(Number(record.expiresAt) > now)) {
    await revokeDeviceRecord(reference, record, "expired");
    clearTrustedDeviceCookie(res, role);
    return false;
  }
  const expected = Buffer.from(String(record.secretHash || ""), "hex");
  const actual = Buffer.from(digest(credential.secret), "hex");
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return false;
  return Number(record.expiresAt);
}

async function revokeDeviceRecord(reference, record, reason) {
  await db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(reference);
    const current = snapshot.data();
    if (!current || current.revokedAt) return;
    transaction.set(reference, { ...current, revokedAt: Date.now(), revokeReason: reason });
  });
}

async function revokeCurrentTrustedDevice(req, res, role, userId = "", reason = "remember-me-disabled") {
  if (!ROLES.has(role)) return;
  const credential = splitCredential(cookieValue(req, role));
  if (credential) {
    const reference = db.collection("trustedDevices").doc(credential.deviceId);
    const snapshot = await reference.get();
    const record = snapshot.data();
    if (record && record.role === role && (!userId || record.userId === userId)) {
      await revokeDeviceRecord(reference, record, reason);
    }
  }
  clearTrustedDeviceCookie(res, role);
}

async function revokeTrustedDevicesForUser(userId, reason) {
  if (!userId) return 0;
  const snapshot = await db.collection("trustedDevices").where("userId", "==", userId).get();
  const active = snapshot.docs.filter((document) => !document.data()?.revokedAt);
  if (!active.length) return 0;
  await db.runTransaction(async (transaction) => {
    for (const document of active) {
      const currentSnapshot = await transaction.get(document.ref);
      const current = currentSnapshot.data();
      if (!current || current.revokedAt) continue;
      transaction.set(document.ref, { ...current, revokedAt: Date.now(), revokeReason: reason });
    }
  });
  return active.length;
}

function getTrustedDeviceExpiresAt(req, role) {
  const credential = splitCredential(cookieValue(req, role));
  if (!credential) return 0;
  return db.collection("trustedDevices").doc(credential.deviceId).get().then((snapshot) => {
    const record = snapshot.data();
    return record && record.role === role && !record.revokedAt ? Number(record.expiresAt) || 0 : 0;
  });
}

module.exports = {
  TRUSTED_DEVICE_TTL_MS,
  trustedDeviceCookieName,
  cookieValue,
  issueTrustedDevice,
  isTrustedDevice,
  revokeCurrentTrustedDevice,
  revokeTrustedDevicesForUser,
  getTrustedDeviceExpiresAt,
};
