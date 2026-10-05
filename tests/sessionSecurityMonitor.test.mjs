import assert from "node:assert/strict";
import { test } from "node:test";
import { monitorSessionSecurity } from "../src/app/services/sessionSecurityMonitor.js";

const flush = () => new Promise((resolve) => setImmediate(resolve));
function events() {
  const callbacks = new Map();
  return { callbacks, addEventListener: (name, callback) => callbacks.set(name, callback),
    removeEventListener: (name) => callbacks.delete(name), emit(name) { callbacks.get(name)?.(); } };
}
function environment(role = "customer") {
  const window = events();
  window.setInterval = (callback, ms) => { assert.equal(ms, 2000); window.poll = callback; return 1; };
  window.clearInterval = () => { window.poll = null; };
  const document = { ...events(), visibilityState: "visible" };
  const connection = events();
  const router = { state: { location: { key: "initial", pathname: `/${role}/dashboard` } },
    subscribe(callback) { router.callback = callback; return () => { router.callback = null; }; },
    navigate(pathname) { router.state.location = { key: pathname, pathname }; router.callback?.(router.state); } };
  return { window, document, connection, router };
}

test("silent checks run for every role on polling, navigation, focus, and network changes", async () => {
  for (const role of ["customer", "admin", "staff"]) {
    const env = environment(role);
    let checks = 0;
    const cleanup = monitorSessionSecurity({ ...env, verify: async () => { checks++; }, onViolation: assert.fail });
    await flush();
    assert.equal(checks, 1);
    for (const trigger of [() => env.window.poll(), () => env.router.navigate(`/${role}/dashboard/profile`),
      () => env.window.emit("focus"), () => env.window.emit("online"), () => env.connection.emit("change")]) {
      trigger(); await flush();
    }
    assert.equal(checks, 6);
    env.document.visibilityState = "hidden";
    env.window.poll(); await flush();
    assert.equal(checks, 6);
    env.document.visibilityState = "visible";
    env.document.emit("visibilitychange"); await flush();
    assert.equal(checks, 7);
    env.router.navigate("/login"); env.window.poll(); await flush();
    assert.equal(checks, 7);
    cleanup();
    assert.equal(env.window.callbacks.size, 0);
    assert.equal(env.connection.callbacks.size, 0);
    assert.equal(env.document.callbacks.size, 0);
    assert.equal(env.router.callback, null);
  }
});

test("transient failures retry silently; confirmed security violations terminate once", async () => {
  const env = environment();
  let checks = 0;
  const warnings = [];
  const cleanup = monitorSessionSecurity({ ...env, verify: async () => {
    checks++;
    if (checks === 1) throw new Error("Network Error");
    throw { response: { data: { message: "VPN use is prohibited", details: { code: "SESSION_SECURITY_VIOLATION" } } } };
  }, onViolation: (message) => warnings.push(message) });
  await flush();
  assert.equal(warnings.length, 0);
  env.window.poll(); await flush();
  assert.deepEqual(warnings, ["VPN use is prohibited"]);
  env.window.poll(); env.connection.emit("change"); await flush();
  assert.equal(checks, 2);
  cleanup();
});

test("dashboard interactions are throttled and router state changes check immediately", async (t) => {
  let time = 1000;
  t.mock.method(Date, "now", () => time);
  const env = environment();
  let checks = 0;
  const cleanup = monitorSessionSecurity({ ...env, verify: async () => { checks++; }, onViolation: assert.fail });
  await flush();
  env.document.emit("pointerdown"); await flush();
  assert.equal(checks, 2);
  env.document.emit("keydown"); env.document.emit("change"); await flush();
  assert.equal(checks, 2);
  time += 1000;
  env.document.emit("change"); await flush();
  assert.equal(checks, 3);
  env.router.state.navigation = { state: "loading" };
  env.router.callback(env.router.state); await flush();
  assert.equal(checks, 4);
  env.router.callback(env.router.state); await flush();
  assert.equal(checks, 4);
  env.router.state.revalidation = "loading";
  env.router.callback(env.router.state); await flush();
  env.window.emit("pageshow"); await flush();
  assert.equal(checks, 6);
  env.document.visibilityState = "hidden";
  time += 1000;
  env.document.emit("pointerdown"); await flush();
  assert.equal(checks, 6);
  cleanup();
  assert.equal(env.document.callbacks.size, 0);
  assert.equal(env.window.callbacks.size, 0);
});

test("network changes during a pending check queue a fresh request without overlapping polls", async () => {
  const env = environment();
  let finish;
  let checks = 0;
  const cleanup = monitorSessionSecurity({ ...env, verify: async () => {
    checks++;
    if (checks === 1) await new Promise((resolve) => { finish = resolve; });
  }, onViolation: assert.fail });
  env.connection.emit("change"); env.window.poll(); env.document.emit("pointerdown");
  assert.equal(checks, 1);
  finish(); await flush();
  assert.equal(checks, 2);
  cleanup();
});

test("a disposed old monitor cannot emit a warning after a new clean session starts", async () => {
  const env = environment();
  let rejectOld;
  let warnings = 0;
  const cleanup = monitorSessionSecurity({ ...env, verify: () => new Promise((_resolve, reject) => { rejectOld = reject; }),
    onViolation: () => { warnings++; } });
  cleanup();
  const cleanupFresh = monitorSessionSecurity({ ...env, verify: async () => {}, onViolation: () => { warnings++; } });
  rejectOld({ response: { data: { details: { code: "SESSION_SECURITY_VIOLATION" }, message: "Old VPN warning" } } });
  await flush();
  env.window.poll(); await flush();
  assert.equal(warnings, 0);
  cleanupFresh();
});
