import assert from "node:assert/strict";
import { test } from "node:test";
import {
  clearRememberedPortalLogin,
  persistRememberedPortalLogin,
  readRememberedPortalLogin,
} from "../src/app/utils/portalRememberMe.js";

test("portal trust survives logout reads, keeps a fixed deadline, and clears on opting out", () => {
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
  const token = `header.${Buffer.from(JSON.stringify({
    role: "staff", type: "remember_device", email: "staff@example.test",
    exp: expiresAt / 1000, iat: timestamp / 1000,
  })).toString("base64url")}.signature`;
  try {
    persistRememberedPortalLogin("staff", token, "staff_username");
    timestamp += 30 * 60 * 1000;
    assert.equal(readRememberedPortalLogin("staff").token, token);
    persistRememberedPortalLogin("staff", token, "staff_username");
    assert.equal(readRememberedPortalLogin("staff").credentials.expiresAt, expiresAt);
    timestamp = expiresAt;
    const expired = readRememberedPortalLogin("staff");
    assert.equal(expired.status, "expired");
    assert.equal(expired.token, "");
    assert.equal(expired.credentials.identifier, "staff_username");
    assert.equal(expired.credentials.password, "");
    assert.equal(storage.has("furfection-remember-device-staff"), false);
    assert.equal(readRememberedPortalLogin("staff").status, "expired");
    clearRememberedPortalLogin("staff");
    assert.equal(readRememberedPortalLogin("staff").status, "empty");
    assert.equal(storage.size, 0);
  } finally {
    Date.now = originalNow;
    delete globalThis.window;
  }
});
