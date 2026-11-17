import { readStorageItem, removeStorageItem, writeStorageItem } from "./browserState.js";

const roles = ["admin", "staff"];
const detailsKey = (role) => `furfection-remember-login-${role}`;

export function clearRememberedPortalLogin(role) {
  (role ? [role] : roles).forEach((value) => {
    removeStorageItem(detailsKey(value));
  });
}

export function persistRememberedPortalLogin(role, identifier, rememberDevice, expiresAt = 0) {
  if (!roles.includes(role) || !String(identifier || "").trim()) {
    clearRememberedPortalLogin(role);
    return;
  }
  const parsedExpiry = typeof expiresAt === "string" ? Date.parse(expiresAt) : Number(expiresAt);
  writeStorageItem(detailsKey(role), JSON.stringify({
    identifier: String(identifier).trim(),
    rememberDevice: rememberDevice === true,
    trustedUntil: Number.isFinite(parsedExpiry) ? parsedExpiry : 0,
    savedAt: Date.now(),
  }));
}

export function readRememberedPortalLogin(role) {
  const records = (role ? [role] : roles).map((value) => {
    let details;
    try { details = JSON.parse(readStorageItem(detailsKey(value)) || "null"); } catch { details = null; }
    if (!details?.identifier) return null;
    const trustedUntil = Number(details.trustedUntil) || 0;
    const trustExpired = Boolean(trustedUntil && trustedUntil <= Date.now());
    return { role: value, status: trustExpired ? "expired" : "active", token: "",
      credentials: { ...details, password: "", trustedUntil } };
  }).filter(Boolean).sort((left, right) => right.credentials.savedAt - left.credentials.savedAt);
  return records[0] || { status: "empty", credentials: null };
}
