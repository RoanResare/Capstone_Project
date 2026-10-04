import assert from "node:assert/strict";
import { after, test } from "node:test";
import { resetTransientAuthStorage, PORTAL_SESSION_STORAGE_KEY, CUSTOMER_SESSION_KEY, PENDING_OTP_STORAGE_KEY,
  LEGACY_AUTH_STORAGE_KEYS, APP_STORAGE_KEY } from "../src/app/utils/browserState.js";
import { clearPortalSession } from "../src/app/utils/portalSession.js";
function storage() { const values = new Map(); return { values, getItem: (key) => values.get(key) ?? null,
  setItem: (key, value) => values.set(key, value), removeItem: (key) => values.delete(key) }; }
const previous = globalThis.window;
globalThis.window = { localStorage: storage(), sessionStorage: storage() };
after(() => { if (previous === undefined) delete globalThis.window; else globalThis.window = previous; });
test("transient token cleanup removes both storage copies without deleting customer data", () => {
  for (const area of [window.localStorage, window.sessionStorage]) {
    for (const key of [PORTAL_SESSION_STORAGE_KEY, CUSTOMER_SESSION_KEY, PENDING_OTP_STORAGE_KEY, ...LEGACY_AUTH_STORAGE_KEYS]) area.setItem(key, "old-token");
    area.setItem(APP_STORAGE_KEY, "customer-data");
  }
  resetTransientAuthStorage();
  for (const area of [window.localStorage, window.sessionStorage]) {
    assert.equal(area.values.size, 1);
    assert.equal(area.getItem(APP_STORAGE_KEY), "customer-data");
  }
  window.localStorage.setItem(PORTAL_SESSION_STORAGE_KEY, "old-token");
  window.sessionStorage.setItem(PORTAL_SESSION_STORAGE_KEY, "old-token");
  clearPortalSession();
  assert.equal(window.localStorage.getItem(PORTAL_SESSION_STORAGE_KEY), null);
  assert.equal(window.sessionStorage.getItem(PORTAL_SESSION_STORAGE_KEY), null);
});
