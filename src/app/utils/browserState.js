export const CURRENT_APP_STATE_VERSION = 4;
export const APP_STORAGE_KEY = `furfection-system-state-v${CURRENT_APP_STATE_VERSION}`;
export const LEGACY_APP_STORAGE_KEYS = [
  "furfection-system-state-v3",
  "furfection-system-state-v2",
];
export const CUSTOMER_STORAGE_KEY = "furfection-customer-accounts";
export const CUSTOMER_SESSION_KEY = "furfection-customer-session";
export const PORTAL_SESSION_STORAGE_KEY = "furfection-portal-session";
export const PENDING_OTP_STORAGE_KEY = "furfection-pending-otp";
export const LEGACY_AUTH_STORAGE_KEYS = ["furfection-auth-session", "furfection-otp-session"];

function isBrowser() {
  return typeof window !== "undefined";
}

function removeFromStorage(storage, key) {
  try {
    storage.removeItem(key);
    return true;
  } catch (error) {
    console.error(`Unable to remove browser storage key "${key}".`, error);
    return false;
  }
}

export function readStorageItem(key) {
  if (!isBrowser()) {
    return null;
  }

  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function readSessionStorageItem(key) {
  if (!isBrowser()) {
    return null;
  }

  try {
    return window.sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

export function writeStorageItem(key, value) {
  if (!isBrowser()) {
    return false;
  }

  try {
    window.localStorage.setItem(key, value);
    return true;
  } catch (error) {
    console.error(`Unable to write browser storage key "${key}".`, error);
    return false;
  }
}

export function writeSessionStorageItem(key, value) {
  if (!isBrowser()) {
    return false;
  }

  try {
    window.sessionStorage.setItem(key, value);
    return true;
  } catch (error) {
    console.error(`Unable to write browser session key "${key}".`, error);
    return false;
  }
}

export function removeStorageItem(key) {
  if (!isBrowser()) {
    return false;
  }

  return removeFromStorage(window.localStorage, key);
}

export function removeSessionStorageItem(key) {
  if (!isBrowser()) {
    return false;
  }

  return removeFromStorage(window.sessionStorage, key);
}

export function resetAppStorage() {
  removeStorageItem(APP_STORAGE_KEY);
  LEGACY_APP_STORAGE_KEYS.forEach((key) => removeStorageItem(key));
}

export function resetCustomerStorage() {
  removeStorageItem(CUSTOMER_STORAGE_KEY);
  removeStorageItem(CUSTOMER_SESSION_KEY);
}

export function resetTransientAuthStorage() {
  removeStorageItem(CUSTOMER_SESSION_KEY);
  removeStorageItem(PORTAL_SESSION_STORAGE_KEY);
  removeStorageItem(PENDING_OTP_STORAGE_KEY);
  removeSessionStorageItem(CUSTOMER_SESSION_KEY);
  removeSessionStorageItem(PENDING_OTP_STORAGE_KEY);
  LEGACY_AUTH_STORAGE_KEYS.forEach((key) => {
    removeStorageItem(key);
    removeSessionStorageItem(key);
  });
}

export function resetAllBrowserState() {
  resetAppStorage();
  resetCustomerStorage();
  resetTransientAuthStorage();
}
