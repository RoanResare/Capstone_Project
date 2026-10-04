import assert from "node:assert/strict";
import { test } from "node:test";
import { monitorSessionSecurity } from "../src/app/services/sessionSecurityMonitor.js";

const flush = () => new Promise((resolve) => setImmediate(resolve));
function events() {
  const callbacks = new Map();
  return {
    callbacks,
    addEventListener: (name, callback) => callbacks.set(name, callback),
    removeEventListener: (name) => callbacks.delete(name),
    emit(name) { callbacks.get(name)?.(); },
  };
}
function environment() {
  const window = events();
  window.setInterval = (callback, delay) => { window.interval = callback; assert.equal(delay, 5000); return 1; };
  window.clearInterval = () => { window.interval = null; };
  const document = { ...events(), visibilityState: "visible" };
  const connection = events();
  const router = { state: { location: { pathname: "/customer/dashboard" } },
    subscribe(callback) { router.callback = callback; return () => { router.callback = null; }; } };
  return { window, document, connection, router };
}

test("dashboard monitoring checks immediately, every five seconds, and on mobile network changes", async () => {
  const env = environment();
  let checks = 0;
  let verified = 0;
  let networkChanges = 0;
  let failures = 0;
  const cleanup = monitorSessionSecurity({ ...env, verify: async () => { checks++; },
    onVerified: () => { verified++; }, onNetworkChange: () => { networkChanges++; },
    onFailure: () => { failures++; } });
  await flush();
  assert.equal(checks, 1);
  assert.equal(verified, 1);
  env.connection.emit("change");
  await flush();
  assert.equal(networkChanges, 1);
  assert.equal(checks, 2);
  env.window.interval();
  await flush();
  assert.equal(checks, 3);
  env.router.callback({ location: { pathname: "/customer/dashboard/profile" } });
  await flush();
  assert.equal(checks, 4);
  assert.equal(failures, 0);
  cleanup();
  assert.equal(env.window.callbacks.size, 0);
  assert.equal(env.connection.callbacks.size, 0);
  assert.equal(env.document.callbacks.size, 0);
  assert.equal(env.router.callback, null);
});

test("a network change during verification queues a fresh check before permitting access", async () => {
  const env = environment();
  let finish;
  let checks = 0;
  let verified = 0;
  let failure;
  const error = new Error("IP changed");
  const cleanup = monitorSessionSecurity({ ...env,
    verify: async () => { checks++; if (checks === 1) await new Promise((resolve) => { finish = resolve; }); else throw error; },
    onVerified: () => { verified++; }, onNetworkChange() {}, onFailure: (value) => { failure = value; } });
  env.connection.emit("change");
  finish();
  await flush();
  assert.equal(checks, 2);
  assert.equal(verified, 0);
  assert.equal(failure, error);
  env.window.interval();
  await flush();
  assert.equal(checks, 2);
  cleanup();
});
