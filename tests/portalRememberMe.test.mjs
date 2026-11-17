import assert from "node:assert/strict";
import { test } from "node:test";
import {
  clearRememberedPortalLogin,
  persistRememberedPortalLogin,
  readRememberedPortalLogin,
} from "../src/app/utils/portalRememberMe.js";

test("portal Remember Me stores only the identifier and consent while server-side trust expires", () => {
  const storage = new Map();
  const originalNow = Date.now;
  let timestamp = 1_800_000_000_000;
  globalThis.window = { localStorage: {
    getItem: (key) => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, value),
    removeItem: (key) => storage.delete(key),
  } };
  Date.now = () => timestamp;
  const expiresAt = timestamp + 14 * 24 * 60 * 60 * 1000;
  try {
    persistRememberedPortalLogin("staff", "staff_username", true, new Date(expiresAt).toISOString());
    timestamp += 30 * 60 * 1000;
    assert.equal(readRememberedPortalLogin("staff").token, "");
    assert.equal(readRememberedPortalLogin("staff").credentials.identifier, "staff_username");
    assert.equal(readRememberedPortalLogin("staff").credentials.rememberDevice, true);
    assert.equal(readRememberedPortalLogin("staff").credentials.trustedUntil, expiresAt);
    assert.equal([...storage.values()].some((value) => value.includes("signature") || value.includes("secret")), false);
    timestamp = expiresAt;
    const expired = readRememberedPortalLogin("staff");
    assert.equal(expired.status, "expired");
    assert.equal(expired.token, "");
    assert.equal(expired.credentials.identifier, "staff_username");
    assert.equal(expired.credentials.password, "");
    assert.equal(storage.has("furfection-remember-login-staff"), true);
    assert.equal(readRememberedPortalLogin("staff").status, "expired");
    persistRememberedPortalLogin("staff", "staff_username", false);
    assert.equal(readRememberedPortalLogin("staff").status, "active");
    assert.equal(readRememberedPortalLogin("staff").credentials.rememberDevice, false);
    clearRememberedPortalLogin("staff");
    assert.equal(readRememberedPortalLogin("staff").status, "empty");
    assert.equal(storage.size, 0);
  } finally {
    Date.now = originalNow;
    delete globalThis.window;
  }
});
