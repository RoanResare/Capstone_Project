import {
  readStorageItem,
  removeStorageItem,
  writeStorageItem,
} from "./browserState.js";

export const CUSTOMER_REMEMBER_ME_DAYS = 14;
export const CUSTOMER_REMEMBER_ME_MS = CUSTOMER_REMEMBER_ME_DAYS * 24 * 60 * 60 * 1000;
export const CUSTOMER_REMEMBER_ME_KEY = "furfection-customer-remember-me-v1";

const LEGACY_CUSTOMER_PASSWORD_KEYS = [
  "furfection-customer-password",
  "furfection-remembered-customer",
  "furfection-remembered-login",
  "furfection-login-credentials",
  "furfection-customer-credentials",
];

function now() {
  return Date.now();
}

function normalizeCredentialRecord(record) {
  if (!record || typeof record !== "object") {
    return null;
  }

  const identifier = typeof record.identifier === "string" ? record.identifier : "";
  const password = typeof record.password === "string" ? record.password : "";
  const expiresAt = Number(record.expiresAt || 0);
  const rememberConsent = record.rememberConsent === true;
  const expired = record.expired === true && expiresAt <= now();

  if (!identifier.trim() || !Number.isFinite(expiresAt) || (!expired && (!password || !rememberConsent))) {
    return null;
  }

  return {
    identifier,
    password,
    rememberConsent,
    savedAt: Number(record.savedAt || 0) || now(),
    expiresAt,
    expired,
  };
}

export function clearLegacyCustomerPasswords() {
  LEGACY_CUSTOMER_PASSWORD_KEYS.forEach((key) => removeStorageItem(key));
}

export function clearRememberedCustomerLogin() {
  removeStorageItem(CUSTOMER_REMEMBER_ME_KEY);
}

export function readRememberedCustomerLogin() {
  clearLegacyCustomerPasswords();

  const raw = readStorageItem(CUSTOMER_REMEMBER_ME_KEY);
  if (!raw) {
    return { status: "empty", credentials: null };
  }

  try {
    const credentials = normalizeCredentialRecord(JSON.parse(raw));
    if (!credentials) {
      clearRememberedCustomerLogin();
      return { status: "empty", credentials: null };
    }

    if (credentials.expiresAt <= now()) {
      const expiredCredentials = { ...credentials, password: "", rememberConsent: false, expired: true };
      writeStorageItem(CUSTOMER_REMEMBER_ME_KEY, JSON.stringify(expiredCredentials));
      return { status: "expired", credentials: expiredCredentials };
    }

    return { status: "active", credentials };
  } catch {
    clearRememberedCustomerLogin();
    return { status: "empty", credentials: null };
  }
}

export function rememberCustomerLogin(identifier, password) {
  const normalizedIdentifier = typeof identifier === "string" ? identifier.trim() : "";
  const normalizedPassword = typeof password === "string" ? password : "";

  if (!normalizedIdentifier || !normalizedPassword) {
    clearRememberedCustomerLogin();
    return false;
  }

  const savedAt = now();
  const existing = readRememberedCustomerLogin();
  const expiresAt = existing.status === "active" && existing.credentials.identifier === normalizedIdentifier
    ? existing.credentials.expiresAt : savedAt + CUSTOMER_REMEMBER_ME_MS;
  return writeStorageItem(
    CUSTOMER_REMEMBER_ME_KEY,
    JSON.stringify({
      identifier: normalizedIdentifier,
      password: normalizedPassword,
      rememberConsent: true,
      savedAt,
      expiresAt,
    }),
  );
}

export function getRememberedCustomerLoginExpiry() {
  const { status, credentials } = readRememberedCustomerLogin();
  return status === "active" || status === "expired" ? credentials.expiresAt : 0;
}
