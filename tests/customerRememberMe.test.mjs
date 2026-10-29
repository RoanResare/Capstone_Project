import assert from "node:assert/strict";
import { test } from "node:test";
import {
  CUSTOMER_REMEMBER_ME_KEY,
  CUSTOMER_REMEMBER_ME_MS,
  getRememberedCustomerLoginExpiry,
  readRememberedCustomerLogin,
  rememberCustomerLogin,
} from "../src/app/utils/customerRememberMe.js";

test("customer expiration clears the password and preserves the identifier across session checks", () => {
  const storage = new Map();
  const originalNow = Date.now;
  let timestamp = 1_800_000_000_000;
  globalThis.window = {
    localStorage: {
      getItem: (key) => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, value),
      removeItem: (key) => storage.delete(key),
    },
  };
  Date.now = () => timestamp;
  try {
    assert.equal(rememberCustomerLogin(" customer_name ", "test-password"), true);
    const expiry = timestamp + CUSTOMER_REMEMBER_ME_MS;
    assert.equal(getRememberedCustomerLoginExpiry(), expiry);
    timestamp += 30 * 60 * 1000;
    rememberCustomerLogin("customer_name", "test-password");
    assert.equal(getRememberedCustomerLoginExpiry(), expiry);
    timestamp = expiry - 1;
    assert.equal(readRememberedCustomerLogin().status, "active");
    timestamp = expiry;
    assert.equal(getRememberedCustomerLoginExpiry(), expiry);
    for (let count = 0; count < 2; count += 1) {
      const remembered = readRememberedCustomerLogin();
      assert.equal(remembered.status, "expired");
      assert.equal(remembered.credentials.identifier, "customer_name");
      assert.equal(remembered.credentials.password, "");
      assert.equal(remembered.credentials.rememberConsent, false);
    }
    assert.equal(storage.get(CUSTOMER_REMEMBER_ME_KEY).includes("test-password"), false);
    storage.set("furfection-customer-password", "legacy-password");
    storage.set(CUSTOMER_REMEMBER_ME_KEY, JSON.stringify({
      identifier: "customer_name", password: "legacy-password",
      rememberConsent: false, expiresAt: timestamp + CUSTOMER_REMEMBER_ME_MS,
    }));
    assert.equal(readRememberedCustomerLogin().status, "empty");
    assert.equal(storage.has("furfection-customer-password"), false);
    assert.equal(storage.has(CUSTOMER_REMEMBER_ME_KEY), false);
  } finally {
    Date.now = originalNow;
    delete globalThis.window;
  }
});
