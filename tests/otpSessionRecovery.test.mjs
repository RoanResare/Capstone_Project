import assert from "node:assert/strict";
import { after, test } from "node:test";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { createServer } from "vite";

const state = {};
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
    enforce: "pre",
    transform(code, id) {
      if (id.replaceAll("\\", "/").endsWith("/useOtpSessionRecovery.js")) {
        return code.replace('from "react"', 'from "otp-test-hooks"');
      }
      if (id.replaceAll("\\", "/").endsWith("/OtpVerification.jsx")) {
        return code.replace('from "motion/react"', 'from "otp-test-motion"');
      }
    },
    resolveId(id) {
      if (id === "otp-test-hooks") return "\0otp-test-hooks";
      if (id === "otp-test-motion") return "\0otp-test-motion";
      if (id.endsWith("context/AuthContext.jsx")) return "\0otp-test-auth";
      if (id.endsWith("context/ToastContext.jsx")) return "\0otp-test-toast";
    },
    load(id) {
      if (id === "\0otp-test-motion") return `import { createElement } from 'react';
        export const motion = { section: ({ initial, animate, transition, ...props }) => createElement('section', props) };`;
      if (id === "\0otp-test-auth") return "export const useAuth = () => globalThis.__otpRecoveryTest.auth;";
      if (id === "\0otp-test-toast") return "export const useToast = () => ({});";
      if (id === "\0otp-test-hooks") return `
        const s = globalThis.__otpRecoveryTest;
        export function useState(initial) {
          if (!s.check) s.check = initial;
          return [s.check, value => { s.check = value; }];
        }
        export function useEffect(effect, deps) {
          if (!s.deps || deps.some((value, i) => value !== s.deps[i])) {
            s.effect = effect; s.deps = deps;
          }
        }`;
    },
  }] });
after(async () => {
  state.cleanup?.();
  await server.close();
  delete globalThis.__otpRecoveryTest;
  if (previousWindow === undefined) delete globalThis.window;
  else globalThis.window = previousWindow;
});
const { useOtpSessionRecovery, OTP_SESSION_GRACE_MS } = await server.ssrLoadModule("/src/app/utils/useOtpSessionRecovery.js");
const { OtpVerification } = await server.ssrLoadModule("/src/app/components/OtpVerification.jsx");
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
  Object.assign(state, { check: null, effect: null, deps: null, cleanup: null });
  timer = null;
}
function html(props) {
  state.auth = props;
  return renderToString(createElement(MemoryRouter, { initialEntries: ["/verify-otp"] }, createElement(OtpVerification)));
}
function assertNeutral(props) {
  const output = html(props);
  assert.match(output, /Checking verification session/);
  assert.doesNotMatch(output, /There is no active OTP challenge/);
  assert.doesNotMatch(output, /Verify and continue/);
}

test("rendered page stays neutral for the full initial window even with a ticket already in state", () => {
  reset();
  const pendingOtp = { otpTicket: "active", role: "admin", otpExpiresAt: new Date(Date.now() + 300000).toISOString() };
  const props = { isLoading: false, pendingOtp, isAuthenticated: false, restorePendingOtpSession: () => pendingOtp };
  assertNeutral(props);
  commit();
  assert.equal(delay, 500);
  assertNeutral(props);
  timer();
  assert.match(html(props), /Verify and continue/);
  assert.doesNotMatch(html(props), /There is no active OTP challenge/);
});

test("rendered missing-challenge card appears only after hydration and the final empty storage check", () => {
  reset();
  let reads = 0;
  const props = { isLoading: true, pendingOtp: null, isAuthenticated: false,
    restorePendingOtpSession() { reads++; return null; } };
  assertNeutral(props);
  commit();
  assert.equal(reads, 0);
  props.isLoading = false;
  assertNeutral(props);
  commit();
  assert.equal(reads, 1);
  assert.equal(delay, OTP_SESSION_GRACE_MS);
  assertNeutral(props);
  timer();
  assert.equal(reads, 2);
  assert.match(html(props), /There is no active OTP challenge/);
});

test("a ticket found at the deadline cannot flash an error while React context is still catching up", () => {
  reset();
  let stored = null;
  const props = { isLoading: false, pendingOtp: null, isAuthenticated: false,
    restorePendingOtpSession() { return stored; } };
  assertNeutral(props);
  commit();
  stored = { otpTicket: "late", role: "staff", otpExpiresAt: new Date(Date.now() + 300000).toISOString() };
  timer();
  // Deliberately delay the provider update beyond the recovery callback.
  assertNeutral(props);
  props.pendingOtp = stored;
  assert.match(html(props), /Verify and continue/);
  assert.doesNotMatch(html(props), /There is no active OTP challenge/);
});

test("a new auth restoration invalidates the earlier empty result and restarts the checking window", () => {
  reset();
  const props = { isLoading: false, pendingOtp: null, isAuthenticated: false,
    restorePendingOtpSession: () => null };
  useOtpSessionRecovery(props);
  commit();
  timer();
  assert.equal(useOtpSessionRecovery(props).canShowMissingChallenge, true);
  props.isLoading = true;
  assertNeutral(props);
  commit();
  props.isLoading = false;
  assertNeutral(props);
  commit();
  assertNeutral(props);
});

test("unmount cancels the pending deadline", () => {
  reset();
  useOtpSessionRecovery({ isLoading: false, pendingOtp: null, isAuthenticated: false,
    restorePendingOtpSession: () => null });
  commit();
  assert.equal(typeof timer, "function");
  state.cleanup();
  assert.equal(timer, null);
});
