import assert from "node:assert/strict";
import { after, test } from "node:test";
import {
  CUSTOMER_REMEMBER_ME_KEY,
  clearRememberedCustomerLogin,
  readRememberedCustomerLogin,
  rememberCustomerLogin,
} from "../src/app/utils/customerRememberMe.js";

function createStorage() {
  const values = new Map();
  return {
    values,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
  };
}

const previousWindow = globalThis.window;
globalThis.window = { localStorage: createStorage() };
after(() => {
  if (previousWindow === undefined) delete globalThis.window;
  else globalThis.window = previousWindow;
});

test("customer Remember Me stores only the identifier and can be cleared when disabled or signing out", () => {
  clearRememberedCustomerLogin();
  assert.equal(rememberCustomerLogin(" customer@example.test "), true);
  const raw = window.localStorage.getItem(CUSTOMER_REMEMBER_ME_KEY);
  assert.ok(raw);
  assert.equal(raw.includes("Secret!"), false);
  assert.equal(readRememberedCustomerLogin().credentials.identifier, "customer@example.test");
  assert.equal("password" in readRememberedCustomerLogin().credentials, false);

  clearRememberedCustomerLogin();
  assert.equal(readRememberedCustomerLogin().status, "empty");
});

test("customer Remember Me refuses an empty identifier", () => {
  assert.equal(rememberCustomerLogin("  "), false);
  assert.equal(window.localStorage.getItem(CUSTOMER_REMEMBER_ME_KEY), null);
});
