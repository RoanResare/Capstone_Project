import assert from "node:assert/strict";
import { after, test } from "node:test";
import { createServer } from "vite";

const state = { auth: { currentUser: null }, values: [], effects: [], profiles: [], profileCalls: 0 };
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
    export const useEffect = (effect) => s.effects.push(effect);
    export function useState(initial) { const i = s.values.length;
      s.values.push(typeof initial === 'function' ? initial() : initial);
      return [s.values[i], (value) => { s.values[i] = typeof value === 'function' ? value(s.values[i]) : value; }]; }`,
  "firebase.js": `export const auth = globalThis.__authRecovery.auth, firebaseConfigError = '', isFirebaseConfigured = true;`,
  "test-firebase-auth": `const s = globalThis.__authRecovery;
    export const browserLocalPersistence = {}, browserSessionPersistence = {};
    export const onAuthStateChanged = (_auth, callback) => { s.listener = callback; return () => {}; };
    export async function signOut() { s.auth.currentUser = null; await s.listener(null); }
    export async function signInWithCustomToken() { return s.signIn(); }
    export async function setPersistence() {}`,
  "apiClient.js": "export const SESSION_SECURITY_EVENT = 'security-event';",
  "firebaseSession.js": "export const waitForFirebaseUserSession = async () => globalThis.__authRecovery.auth.currentUser;",
  "firebaseAuth.js": `export const formatFirebaseAuthError = (e) => e.message, isFirebaseConnectionIssue = () => false;
    export function loadExistingUserProfile() { const s = globalThis.__authRecovery; s.profileCalls++; return s.profiles.shift().promise; }
    export async function signInWithEmailPassword() {}
    export async function updateFirebaseUserProfile() {}`,
  "customerAccount.js": `export function loadOrCreateCustomerProfile() { const s = globalThis.__authRecovery; s.profileCalls++; return s.profiles.shift().promise; }
    export async function signInCustomerWithEmailPassword() {}
    export async function signUpCustomerWithEmailPassword() {}
    export async function updateCustomerProfile() {}`,
  "authApi.js": ["completeBackendPasswordReset", "checkCustomerRegistrationAvailability", "loginUnifiedUser", "loginPortalUser",
    "requestBackendPasswordReset", "resendPortalOtp", "validateBackendPasswordResetCode", "verifyPortalOtp"]
    .map((name) => `export async function ${name}() { ${name === "loginUnifiedUser" ? "return globalThis.__authRecovery.loginResponse;" : name === "checkCustomerRegistrationAvailability" ? "throw new Error('Temporary or disposable email addresses are not allowed');" : ""} }`).join("\n"),
};
const server = await createServer({ configFile: false, server: { middlewareMode: true }, appType: "custom", logLevel: "silent",
  plugins: [{ name: "auth-recovery-test", enforce: "pre",
    transform(code, id) { if (id.replaceAll("\\", "/").endsWith("/context/AuthContext.jsx")) return code
      .replace('from "react"', 'from "test-auth-hooks"').replace('from "firebase/auth"', 'from "test-firebase-auth"'); },
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

test("late hydration cannot overwrite fresh credentials even when Firebase reuses the same user object", async () => {
  const old = deferred(); const fresh = deferred();
  state.profiles.push(old, fresh);
  let token = "old-token";
  const user = { uid: "customer", email: "customer@gmail.com", getIdToken: async () => token,
    getIdTokenResult: async () => ({ claims: { role: "customer" } }) };
  state.auth.currentUser = user;
  const pendingOld = state.listener(user);
  await flush();
  assert.equal(state.profileCalls, 1);
  token = "fresh-token";
  const pendingFresh = state.listener(user);
  await flush();
  fresh.resolve({ uid: "customer", role: "customer", name: "Fresh" });
  await pendingFresh;
  old.resolve({ uid: "customer", role: "customer", name: "Old" });
  await pendingOld;
  assert.equal(state.values[0].name, "Fresh");
  assert.equal(state.values[1], "fresh-token");
});

test("logout clears state before pending hydration can restore a cached session", async () => {
  const pending = deferred(); state.profiles.push(pending);
  const user = { uid: "customer", email: "customer@gmail.com", getIdToken: async () => "stale-token",
    getIdTokenResult: async () => ({ claims: { role: "customer" } }) };
  state.auth.currentUser = user;
  const hydration = state.listener(user);
  await flush();
  await value.signOut();
  pending.resolve({ uid: "customer", role: "customer" });
  await hydration;
  assert.equal(state.values[0], null);
  assert.equal(state.values[1], "");
});

test("verified fresh login replaces cached tokens and warnings for every role despite delayed null callbacks", async () => {
  for (const role of ["customer", "admin", "staff"]) {
    const token = `test.${Buffer.from(JSON.stringify({ sub: role, role, exp: Math.floor(Date.now() / 1000) + 3600 })).toString("base64url")}.signature`;
    state.loginResponse = { user: { uid: role, role }, accessToken: token, firebaseCustomToken: "new-custom-token" };
    window.localStorage.setItem("furfection-portal-session", "stale-token");
    window.sessionStorage.setItem("furfection-portal-session", "stale-token");
    for (const area of [window.localStorage, window.sessionStorage]) area.setItem("furfection-security-warning", "old restriction");
    let refreshed = false;
    const user = { uid: role, email: `${role}@gmail.com`, getIdToken: async (force) => { if (force) refreshed = true; return "new-id-token"; },
      getIdTokenResult: async () => ({ claims: { role } }) };
    state.profiles.push({ promise: Promise.resolve({ uid: role, role }) });
    state.signIn = async () => {
      // Reproduce a late sign-out event after the new portal token has been persisted.
      await state.listener(null);
      if (role !== "customer") assert.ok(window.localStorage.getItem("furfection-portal-session"));
      state.auth.currentUser = user;
      await state.listener(user);
      return { user };
    };
    const result = await value.beginUnifiedLogin({ identifier: user.email, password: "Password!" });
    assert.equal(result.ok, true, result.error);
    assert.equal(state.values[0].role, role);
    assert.equal(state.values[1], role === "customer" ? "new-id-token" : token);
    assert.equal(refreshed, true);
    assert.equal(window.sessionStorage.getItem("furfection-portal-session"), null);
    for (const area of [window.localStorage, window.sessionStorage]) assert.equal(area.getItem("furfection-security-warning"), null);
  }
});

test("rejected signup leaves the existing identity, token, and stored session untouched", async () => {
  const existingUser = state.auth.currentUser;
  const existingProfile = state.values[0];
  const existingToken = state.values[1];
  window.localStorage.setItem("furfection-portal-session", "existing-session");
  for (let attempt = 0; attempt < 3; attempt++) {
    const result = await value.signUp({ fullName: "Reused Name", email: "same@yzcalo.com",
      username: "reused_name", phone: "09620614953", password: "Test123!", confirmPassword: "Test123!" });
    assert.equal(result.ok, false);
    assert.equal(result.error, "Temporary or disposable email addresses are not allowed");
  }
  assert.equal(state.auth.currentUser, existingUser);
  assert.equal(state.values[0], existingProfile);
  assert.equal(state.values[1], existingToken);
  assert.equal(window.localStorage.getItem("furfection-portal-session"), "existing-session");
});
