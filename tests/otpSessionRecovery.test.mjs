import assert from "node:assert/strict";
import { after, test } from "node:test";
import { createServer } from "vite";

const state = { checked: false, effect: null, deps: null, cleanup: null };
globalThis.__otpRecoveryTest = state;
const previousWindow = globalThis.window;
let timer;
let delay;
globalThis.window = {
  setTimeout(callback, ms) { timer = callback; delay = ms; return 1; },
  clearTimeout() { timer = null; },
};
const server = await createServer({ configFile: false, server: { middlewareMode: true },
  appType: "custom", logLevel: "silent", plugins: [{
    name: "otp-recovery-hooks",
    transform(code, id) {
      if (id.replaceAll("\\", "/").endsWith("/useOtpSessionRecovery.js")) {
        return code.replace('from "react"', 'from "otp-test-hooks"');
      }
    },
    resolveId(id) { if (id === "otp-test-hooks") return "\0otp-test-hooks"; },
    load(id) {
      if (id === "\0otp-test-hooks") return `
        const s = globalThis.__otpRecoveryTest;
        export function useState() { return [s.checked, value => { s.checked = value; }]; }
        export function useEffect(effect, deps) {
          if (!s.deps || deps.some((value, i) => value !== s.deps[i])) {
            s.effect = effect; s.deps = deps;
          }
        }`;
    },
  }] });
after(async () => {
  await server.close();
  delete globalThis.__otpRecoveryTest;
  if (previousWindow === undefined) delete globalThis.window;
  else globalThis.window = previousWindow;
});
const { useOtpSessionRecovery, OTP_SESSION_GRACE_MS } = await server.ssrLoadModule("/src/app/utils/useOtpSessionRecovery.js");
function render(props) { return useOtpSessionRecovery(props); }
function commit() {
  if (state.effect) {
    state.cleanup?.();
    const effect = state.effect;
    state.effect = null;
    state.cleanup = effect();
  }
}
function reset() {
  state.cleanup?.();
  Object.assign(state, { checked: false, effect: null, deps: null, cleanup: null });
  timer = null;
}

test("first render checks storage even when Firebase loading already finished", () => {
  reset();
  let calls = 0;
  const props = { isLoading: false, pendingOtp: null, isAuthenticated: false,
    restorePendingOtpSession() { calls++; props.pendingOtp = { otpTicket: "active-ticket" }; return props.pendingOtp; } };
  assert.equal(render(props), true, "initial render must hide the missing-challenge screen");
  commit();
  assert.equal(calls, 1);
  assert.equal(render(props), false);
  commit();
  assert.equal(timer, null, "valid challenges need no artificial delay");
});

test("a challenge arriving during the grace window is recovered on the final check", () => {
  reset();
  let stored = null;
  const reasons = [];
  const props = { isLoading: false, pendingOtp: null, isAuthenticated: false,
    restorePendingOtpSession(reason) { reasons.push(reason); props.pendingOtp = stored; return stored; } };
  assert.equal(render(props), true);
  commit();
  assert.equal(delay, OTP_SESSION_GRACE_MS);
  assert.equal(render(props), true);
  stored = { otpTicket: "late-ticket" };
  timer();
  assert.equal(render(props), false);
  assert.equal(props.pendingOtp, stored);
  assert.deepEqual(reasons, ["otp-page-mount", "otp-page-grace"]);
});

test("genuinely missing challenges appear only after hydration and the grace check", () => {
  reset();
  let reads = 0;
  const props = { isLoading: true, pendingOtp: null, isAuthenticated: false,
    restorePendingOtpSession() { reads++; return null; } };
  assert.equal(render(props), true);
  commit();
  assert.equal(reads, 0);
  props.isLoading = false;
  assert.equal(render(props), true);
  commit();
  assert.equal(reads, 1);
  timer();
  assert.equal(reads, 2);
  assert.equal(render(props), false);
});

test("challenge arrival cancels recovery timers and verified sessions proceed immediately", () => {
  reset();
  const props = { isLoading: false, pendingOtp: null, isAuthenticated: false,
    restorePendingOtpSession() { return null; } };
  render(props);
  commit();
  assert.equal(typeof timer, "function");
  props.pendingOtp = { otpTicket: "new-ticket" };
  assert.equal(render(props), false);
  commit();
  assert.equal(timer, null);
  reset();
  assert.equal(render({ ...props, pendingOtp: null, isAuthenticated: true }), false);
});
