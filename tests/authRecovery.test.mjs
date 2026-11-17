import assert from "node:assert/strict";
import { after, test } from "node:test";
import { createServer } from "vite";

const state = { session: null, values: [], effects: [], profiles: [], profileCalls: 0 };
const previousWindow = globalThis.window;
function storage() { const values = new Map(); return { getItem: (key) => values.get(key) ?? null,
  setItem: (key, value) => values.set(key, value), removeItem: (key) => values.delete(key) }; }
globalThis.window = { localStorage: storage(), sessionStorage: storage(), addEventListener() {}, removeEventListener() {} };
globalThis.__authRecovery = state;
const mocks = {
  "test-auth-hooks": `const s = globalThis.__authRecovery;
    export const createContext = () => ({ Provider: 'provider' });
    export const useContext = () => null;
    export const useRef = (current) => ({ current });
    export const useCallback = (callback) => callback;
    export const useEffect = (effect) => s.effects.push(effect);
    export function useState(initial) { const i = s.values.length;
      s.values.push(typeof initial === 'function' ? initial() : initial);
      return [s.values[i], (value) => { s.values[i] = typeof value === 'function' ? value(s.values[i]) : value; }]; }`,
  "supabaseConfig.js": "export const isSupabaseConfigured = true;",
  "supabaseSession.js": `const s = globalThis.__authRecovery;
    export const auth = { get currentUser() { return s.session?.user || null; } };
    export const supabase = {};
    export function subscribeSupabaseAuth(callback) { s.listener = callback; return () => {}; }
    export async function getSupabaseSession() { return s.session; }
    export async function loadSupabaseProfile() { s.profileCalls++; return s.profiles.shift().promise; }
    export async function installSupabaseSession(session) { s.session = session; return session; }
    export async function signOutSupabase() { s.session = null; if (s.listener) await s.listener('SIGNED_OUT', null); }
    export function setSupabaseSessionPersistence() {}`,
  "apiClient.js": "export const SESSION_SECURITY_EVENT = 'security-event';",
  "apiClient.js": "export const SESSION_SECURITY_EVENT = 'security-event';",
  "customerAccount.js": `export function loadOrCreateCustomerProfile() { const s = globalThis.__authRecovery; s.profileCalls++; return s.profiles.shift().promise; }
    export async function signInCustomerWithEmailPassword() {}
    export async function signUpCustomerWithEmailPassword() { throw new Error('Temporary or disposable email addresses are not allowed'); }
    export async function updateCustomerProfile() {}`,
  "authApi.js": ["completeBackendPasswordReset", "checkCustomerRegistrationAvailability", "loginUnifiedUser", "loginPortalUser",
    "requestBackendPasswordReset", "resendPortalOtp", "validateBackendPasswordResetCode", "verifyPortalOtp"]
    .map((name) => `export async function ${name}() { ${["loginUnifiedUser", "loginPortalUser"].includes(name) ? "return globalThis.__authRecovery.loginResponse;" : name === "checkCustomerRegistrationAvailability" ? "throw new Error('Temporary or disposable email addresses are not allowed');" : ""} }`).join("\n"),
};
const server = await createServer({ configFile: false, server: { middlewareMode: true }, appType: "custom", logLevel: "silent",
  plugins: [{ name: "auth-recovery-test", enforce: "pre",
    transform(code, id) { if (id.replaceAll("\\", "/").endsWith("/context/AuthContext.jsx")) return code
      .replace('from "react"', 'from "test-auth-hooks"'); },
    resolveId(source) { const key = Object.keys(mocks).find((value) => source === value || source.endsWith(`/${value}`));
      if (key) return `\0auth-recovery:${key}`; },
    load(id) { if (id.startsWith("\0auth-recovery:")) return mocks[id.slice("\0auth-recovery:".length)]; },
  }],
});
after(async () => { await server.close(); delete globalThis.__authRecovery; });
const { AuthProvider } = await server.ssrLoadModule("/src/app/context/AuthContext.jsx");
const value = AuthProvider({ children: null }).props.value;
const cleanups = state.effects.map((effect) => effect());
after(() => {
  cleanups.forEach((cleanup) => { if (typeof cleanup === "function") cleanup(); });
  if (previousWindow === undefined) delete globalThis.window; else globalThis.window = previousWindow;
});
function deferred() { let resolve; const promise = new Promise((done) => { resolve = done; }); return { promise, resolve }; }
const flush = () => new Promise((resolve) => setImmediate(resolve));

test("late Supabase profile hydration cannot overwrite a newer session for the same identity", async () => {
  const old = deferred(); const fresh = deferred();
  state.profiles.push(old, fresh);
  const user = { id: "customer", email: "customer@gmail.com" };
  state.session = { user, access_token: "old-token", refresh_token: "refresh-old" };
  const pendingOld = state.listener("TOKEN_REFRESHED", state.session);
  await flush();
  assert.equal(state.profileCalls, 1);
  state.session = { user, access_token: "fresh-token", refresh_token: "refresh-fresh" };
  const pendingFresh = state.listener("TOKEN_REFRESHED", state.session);
  await flush();
  fresh.resolve({ uid: "customer", role: "customer", name: "Fresh" });
  await pendingFresh;
  old.resolve({ uid: "customer", role: "customer", name: "Old" });
  await pendingOld;
  assert.equal(state.values[0].name, "Fresh");
  assert.equal(state.values[1], "fresh-token");
});

test("logout clears state before pending Supabase profile hydration can restore a cached session", async () => {
  const pending = deferred(); state.profiles.push(pending);
  const user = { id: "customer", email: "customer@gmail.com" };
  state.session = { user, access_token: "stale-token", refresh_token: "stale-refresh" };
  const hydration = state.listener("SIGNED_IN", state.session);
  await flush();
  await value.signOut();
  pending.resolve({ uid: "customer", role: "customer" });
  await hydration;
  assert.equal(state.values[0], null);
  assert.equal(state.values[1], "");
});

test("verified fresh Supabase login replaces cached tokens and warnings for every role", async () => {
  for (const role of ["customer", "admin", "staff"]) {
    const token = "new-supabase-access-token";
    const user = { id: role, email: `${role}@gmail.com` };
    state.loginResponse = { user: { uid: role, role, email: user.email },
      supabaseSession: { user, access_token: token, refresh_token: `refresh-${role}` } };
    window.localStorage.setItem("furfection-portal-session", "stale-token");
    window.sessionStorage.setItem("furfection-portal-session", "stale-token");
    for (const area of [window.localStorage, window.sessionStorage]) area.setItem("furfection-security-warning", "old restriction");
    state.profiles.push({ promise: Promise.resolve({ uid: role, role }) });
    const result = await value.beginUnifiedLogin({ identifier: user.email, password: "Password!" });
    assert.equal(result.ok, true, result.error);
    assert.equal(state.values[0].role, role);
    assert.equal(state.values[1], token);
    assert.equal(window.sessionStorage.getItem("furfection-portal-session"), null);
    for (const area of [window.localStorage, window.sessionStorage]) assert.equal(area.getItem("furfection-security-warning"), null);
  }
});

test("Customer Remember Me ON stores only the identifier and OFF clears it", async () => {
  const key = "furfection-customer-remember-me-v1";
  for (const rememberDevice of [true, false]) {
    window.localStorage.removeItem(key);
    const user = { id: "customer-remember", email: "customer@gmail.com" };
    state.loginResponse = {
      user: { uid: user.id, role: "customer", email: user.email },
      supabaseSession: { user, access_token: "customer-access", refresh_token: "customer-refresh" },
    };
    state.profiles.push({ promise: Promise.resolve({ uid: user.id, role: "customer", email: user.email }) });
    const result = await value.beginUnifiedLogin({ identifier: user.email, password: "Password!", rememberDevice });
    assert.equal(result.ok, true, result.error);
    const saved = window.localStorage.getItem(key);
    assert.equal(Boolean(saved), rememberDevice);
    if (rememberDevice) {
      const record = JSON.parse(saved);
      assert.equal(record.identifier, user.email);
      assert.equal(record.rememberConsent, true);
      assert.equal("password" in record, false);
    }
  }
});

test("rejected signup leaves the existing identity, token, and stored session untouched", async () => {
  const existingSession = state.session;
  const existingProfile = state.values[0];
  const existingToken = state.values[1];
  window.localStorage.setItem("furfection-portal-session", "existing-session");
  for (let attempt = 0; attempt < 3; attempt++) {
    const result = await value.signUp({ fullName: "Reused Name", email: "same@yzcalo.com",
      username: "reused_name", phone: "09620614953", password: "Test123!", confirmPassword: "Test123!",
      termsAndConditionsAccepted: true, privacyPolicyAccepted: true });
    assert.equal(result.ok, false);
    assert.equal(result.error, "Temporary or disposable email addresses are not allowed");
  }
  assert.equal(state.session, existingSession);
  assert.equal(state.values[0], existingProfile);
  assert.equal(state.values[1], existingToken);
  assert.equal(window.localStorage.getItem("furfection-portal-session"), "existing-session");
});

test("OTP handoff survives stale Supabase hydration for admin and staff through both login entry points", async () => {
  for (const role of ["admin", "staff"]) {
    for (const entry of ["beginUnifiedLogin", "beginLogin"]) {
      const pending = deferred();
      state.profiles.push(pending);
      const oldUser = { id: "old-customer", email: "old@gmail.com" };
      state.session = { user: oldUser, access_token: "old-token", refresh_token: "old-refresh" };
      const hydration = state.listener("SIGNED_IN", state.session);
      await flush();
      const ticket = `test.${Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 600 })).toString("base64url")}.signature`;
      state.loginResponse = { requiresTwoFactor: true, user: { role, email: `${role}@gmail.com` },
        otpTicket: ticket, otpExpiresAt: new Date(Date.now() + 300000).toISOString() };
      const result = await value[entry]({ identifier: `${role}@gmail.com`, password: "Password!", role,
        requestedPath: "/portal/appointments" });
      pending.resolve({ uid: "old-customer", role: "customer" });
      await hydration;
      // A delayed signed-out callback must restore, rather than erase, the challenge.
      await state.listener("SIGNED_OUT", null);
      assert.equal(result.ok, true, result.error);
      assert.equal(result.verificationPath, "/verify-otp");
      assert.equal(state.values[0], null);
      assert.equal(state.values[1], "");
      const stored = JSON.parse(window.sessionStorage.getItem("furfection-pending-otp"));
      assert.equal(stored.otpTicket, ticket);
      assert.equal(stored.role, role);
      assert.equal(stored.requestedPath, "/portal/appointments");
      assert.equal(state.values.at(-1).otpTicket, ticket);
    }
  }
});

test("a stored OTP challenge wins over an old Supabase identity on reload", async () => {
  for (const role of ["admin", "staff"]) {
    value.clearPendingOtp();
    const ticket = `test.${Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 600 })).toString("base64url")}.signature`;
    window.sessionStorage.setItem("furfection-pending-otp", JSON.stringify({ role, otpTicket: ticket,
      email: `${role}@gmail.com`, otpExpiresAt: new Date(Date.now() + 300000).toISOString() }));
    const profileCalls = state.profileCalls;
    state.session = { user: { id: "old-identity" }, access_token: "old", refresh_token: "old-refresh" };
    await state.listener("SIGNED_IN", state.session);
    assert.equal(state.profileCalls, profileCalls, "must not hydrate the old profile or clear the challenge");
    assert.equal(state.session, null);
    assert.equal(state.values[0], null);
    assert.equal(value.restorePendingOtpSession().otpTicket, ticket);
    assert.equal(JSON.parse(window.sessionStorage.getItem("furfection-pending-otp")).otpTicket, ticket);
  }
});

test("a delayed signed-out event preserves the in-memory challenge when browser storage is unavailable", async () => {
  // Storage can be cleared or blocked independently of the current tab's React state.
  const challenge = value.restorePendingOtpSession();
  window.sessionStorage.removeItem("furfection-pending-otp");
  window.localStorage.removeItem("furfection-pending-otp");
  await state.listener("SIGNED_OUT", null);
  assert.equal(state.values.at(-1).otpTicket, challenge.otpTicket);
  assert.equal(value.restorePendingOtpSession().otpTicket, challenge.otpTicket);
  value.clearPendingOtp();
  assert.equal(value.restorePendingOtpSession(), null, "explicit cancellation must clear memory too");
});

test("recovery rejects expired tickets instead of reviving an unusable challenge", () => {
  value.clearPendingOtp();
  const ticket = `test.${Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) - 60 })).toString("base64url")}.signature`;
  for (const storage of [window.localStorage, window.sessionStorage]) {
    storage.setItem("furfection-pending-otp", JSON.stringify({ role: "admin", otpTicket: ticket }));
  }
  assert.equal(value.restorePendingOtpSession(), null);
  assert.equal(window.sessionStorage.getItem("furfection-pending-otp"), null);
  assert.equal(window.localStorage.getItem("furfection-pending-otp"), null);
});

test("an expired in-memory challenge cannot erase a valid stored replacement", async () => {
  value.clearPendingOtp();
  const originalNow = Date.now;
  const now = originalNow();
  const ticket = (exp) => `test.${Buffer.from(JSON.stringify({ exp })).toString("base64url")}.signature`;
  state.loginResponse = { requiresTwoFactor: true, user: { role: "admin" },
    otpTicket: ticket(Math.floor(now / 1000) + 60) };
  assert.equal((await value.beginUnifiedLogin({ identifier: "admin@gmail.com", password: "Password!" })).ok, true);
  const replacement = { role: "staff", otpTicket: ticket(Math.floor(now / 1000) + 600) };
  window.sessionStorage.setItem("furfection-pending-otp", JSON.stringify(replacement));
  try {
    Date.now = () => now + 120000;
    assert.equal(value.restorePendingOtpSession().otpTicket, replacement.otpTicket);
    assert.equal(JSON.parse(window.sessionStorage.getItem("furfection-pending-otp")).otpTicket, replacement.otpTicket);
  } finally {
    Date.now = originalNow;
    value.clearPendingOtp();
  }
});
