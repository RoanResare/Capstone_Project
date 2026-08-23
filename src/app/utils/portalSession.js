import {
  PENDING_OTP_STORAGE_KEY,
  PORTAL_SESSION_STORAGE_KEY,
  readSessionStorageItem,
  readStorageItem,
  removeSessionStorageItem,
  removeStorageItem,
  writeSessionStorageItem,
  writeStorageItem,
} from "./browserState.js";

function parseJson(value) {
  if (typeof value !== "string" || !value.trim()) {
    return null;
  }

  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function normalizeTimestamp(value) {
  const timestamp = typeof value === "string" ? value.trim() : "";
  return timestamp ? timestamp : "";
}

export function decodeJwtPayload(token = "") {
  const value = typeof token === "string" ? token.trim() : "";

  if (!value) {
    return null;
  }

  const parts = value.split(".");

  if (parts.length < 2) {
    return null;
  }

  try {
    const normalizedPayload = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const paddedPayload = normalizedPayload.padEnd(
      normalizedPayload.length + ((4 - (normalizedPayload.length % 4)) % 4),
      "=",
    );
    const json =
      typeof window !== "undefined" && typeof window.atob === "function"
        ? window.atob(paddedPayload)
        : globalThis.Buffer
          ? globalThis.Buffer.from(paddedPayload, "base64").toString("utf8")
          : "";

    return json ? JSON.parse(json) : null;
  } catch {
    return null;
  }
}

export function createPortalSessionRecord(accessToken) {
  const payload = decodeJwtPayload(accessToken);
  const expiresAt =
    typeof payload?.exp === "number" ? new Date(payload.exp * 1000).toISOString() : "";

  return {
    accessToken,
    uid: typeof payload?.sub === "string" ? payload.sub : "",
    role: typeof payload?.role === "string" ? payload.role.trim().toLowerCase() : "",
    expiresAt,
  };
}

export function hasPortalSessionExpired(session) {
  const expiresAt = normalizeTimestamp(session?.expiresAt);

  if (!expiresAt) {
    return true;
  }

  const parsed = new Date(expiresAt);
  return Number.isNaN(parsed.getTime()) || parsed.getTime() <= Date.now();
}

export function persistPortalSession(session) {
  if (!session || typeof session !== "object") {
    clearPortalSession();
    return false;
  }

  return writeStorageItem(PORTAL_SESSION_STORAGE_KEY, JSON.stringify(session));
}

export function readPortalSession() {
  const parsed = parseJson(readStorageItem(PORTAL_SESSION_STORAGE_KEY));

  if (!parsed || typeof parsed !== "object") {
    return null;
  }

  return {
    accessToken: typeof parsed.accessToken === "string" ? parsed.accessToken : "",
    uid: typeof parsed.uid === "string" ? parsed.uid : "",
    role: typeof parsed.role === "string" ? parsed.role.trim().toLowerCase() : "",
    expiresAt: normalizeTimestamp(parsed.expiresAt),
  };
}

export function clearPortalSession() {
  removeStorageItem(PORTAL_SESSION_STORAGE_KEY);
}

export function persistPendingOtpSession(session) {
  if (!session || typeof session !== "object") {
    clearPendingOtpSession();
    return false;
  }

  const serialized = JSON.stringify(session);
  const wroteSession = writeSessionStorageItem(PENDING_OTP_STORAGE_KEY, serialized);
  const wroteLocal = writeStorageItem(PENDING_OTP_STORAGE_KEY, serialized);

  return wroteSession || wroteLocal;
}

export function readPendingOtpSession() {
  const sessionValue = readSessionStorageItem(PENDING_OTP_STORAGE_KEY);
  const localValue = readStorageItem(PENDING_OTP_STORAGE_KEY);
  const raw = sessionValue || localValue;

  if (!sessionValue && localValue) {
    writeSessionStorageItem(PENDING_OTP_STORAGE_KEY, localValue);
  }

  const parsed = parseJson(raw);

  if (!parsed || typeof parsed !== "object") {
    return null;
  }

  return {
    deliveryMode: typeof parsed.deliveryMode === "string" ? parsed.deliveryMode : "",
    email: typeof parsed.email === "string" ? parsed.email : "",
    otpExpiresAt: normalizeTimestamp(parsed.otpExpiresAt),
    otpTicket: typeof parsed.otpTicket === "string" ? parsed.otpTicket : "",
    requestedPath: typeof parsed.requestedPath === "string" ? parsed.requestedPath : "",
    resendAvailableAt: normalizeTimestamp(parsed.resendAvailableAt),
    role: typeof parsed.role === "string" ? parsed.role.trim().toLowerCase() : "",
  };
}

export function clearPendingOtpSession() {
  removeStorageItem(PENDING_OTP_STORAGE_KEY);
  removeSessionStorageItem(PENDING_OTP_STORAGE_KEY);
}
