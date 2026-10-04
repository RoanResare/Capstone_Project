import { readStorageItem, removeStorageItem, writeStorageItem } from "./browserState.js";
import { decodeJwtPayload } from "./portalSession.js";

const roles = ["admin", "staff"];
const tokenKey = (role) => `furfection-remember-device-${role}`;
const detailsKey = (role) => `furfection-remember-login-${role}`;

export function clearRememberedPortalLogin(role) {
  (role ? [role] : roles).forEach((value) => {
    removeStorageItem(tokenKey(value));
    removeStorageItem(detailsKey(value));
  });
}

export function persistRememberedPortalLogin(role, token, identifier) {
  const payload = decodeJwtPayload(token);
  if (!roles.includes(role) || payload?.role !== role || payload?.type !== "remember_device" ||
      !Number.isFinite(payload.exp) || payload.exp * 1000 <= Date.now()) {
    clearRememberedPortalLogin(role);
    return;
  }
  writeStorageItem(tokenKey(role), token);
  writeStorageItem(detailsKey(role), JSON.stringify({
    identifier: identifier || payload.email,
    expiresAt: payload.exp * 1000,
    savedAt: Date.now(),
  }));
}

export function readRememberedPortalLogin(role) {
  const records = (role ? [role] : roles).map((value) => {
    const token = readStorageItem(tokenKey(value)) || "";
    const payload = decodeJwtPayload(token);
    let details;
    try { details = JSON.parse(readStorageItem(detailsKey(value)) || "null"); } catch { details = null; }
    if (!details && payload?.role === value && payload?.type === "remember_device") {
      details = { identifier: payload.email, expiresAt: payload.exp * 1000, savedAt: payload.iat * 1000 };
    }
    if (!details?.identifier || !Number.isFinite(details.expiresAt)) return null;
    const active = payload?.role === value && payload?.type === "remember_device" &&
      payload.exp * 1000 === details.expiresAt && details.expiresAt > Date.now();
    if (!active) {
      removeStorageItem(tokenKey(value));
      writeStorageItem(detailsKey(value), JSON.stringify(details));
    }
    return { role: value, status: active ? "active" : "expired", token: active ? token : "",
      credentials: { ...details, password: "" } };
  }).filter(Boolean).sort((left, right) => right.credentials.savedAt - left.credentials.savedAt);
  return records[0] || { status: "empty", credentials: null };
}
