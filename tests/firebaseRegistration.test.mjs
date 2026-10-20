import assert from "node:assert/strict";
import { after, test } from "node:test";
import { createServer } from "vite";

function deferred() {
  let resolve;
  const promise = new Promise((complete) => { resolve = complete; });
  return { promise, resolve };
}
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const state = {
  auth: { currentUser: null, authStateReady: async () => {} },
  persistence: deferred(), listeners: new Set(), documents: new Map(), reads: [], commits: [], validationChecks: [],
};
globalThis.__firebaseRegistrationTest = state;
const mocks = {
  "apiClient.js": `const state = globalThis.__firebaseRegistrationTest;
    export const buildAuthHeaders = token => ({Authorization: 'Bearer ' + token});
    export const extractApiError = (error, fallback) => error.response?.data?.message || error.message || fallback;
    export const apiClient = {async post(url, payload, options) {
      if (options.headers.Authorization !== 'Bearer valid-id-token') throw new Error('Missing token');
      if (url !== '/auth/register/profile') throw new Error('Unexpected API call');
      state.apiCalls = (state.apiCalls || 0) + 1;
      if (state.apiError) throw state.apiError;
      if (state.invalidResponse) return {data: {profile: state.invalidResponse}};
      const profile = {...payload, uid: state.auth.currentUser.uid,
        accountStatus: 'inactive', status: 'inactive', verificationStatus: 'pending'};
      state.documents.set('users/' + profile.uid, profile);
      return {data: {profile}};
    }};`,
  "authApi.js": `export async function validateBackendEmail() {}
    export async function checkCustomerRegistrationAvailability(data) {
      const state = globalThis.__firebaseRegistrationTest;
      state.validationChecks.push(data);
      if (data.email.endsWith('@yzcalo.com')) throw new Error('Temporary or disposable email addresses are not allowed');
      return {registrationIp: '1.2.3.4'};
    }`,
  "sessionSecurity.js": "export async function verifyActiveSessionSecurity() {}",
  "firebase.js": `const state = globalThis.__firebaseRegistrationTest;
    export const auth = state.auth, db = {}, firebaseConfigError = '', isFirebaseConfigured = true;
    export const authPersistenceReadyPromise = state.persistence.promise;`,
  "firebase/auth": `const state = globalThis.__firebaseRegistrationTest;
    export function onIdTokenChanged(auth, callback) {
      state.listeners.add(callback); callback(auth.currentUser);
      return () => state.listeners.delete(callback);
    }
    export async function createUserWithEmailAndPassword() {return state.createUser();}
    export async function deleteUser(user) {if (state.auth.currentUser === user) state.auth.currentUser = null;}
    export async function signOut() {state.auth.currentUser = null;}
    export async function confirmPasswordReset() {}
    export async function fetchSignInMethodsForEmail() {}
    export async function sendPasswordResetEmail() {}
    export async function verifyPasswordResetCode() {}
    export const EmailAuthProvider = {};
    export async function getIdTokenResult() {return {claims: {}};}
    export async function reauthenticateWithCredential() {}
    export async function signInWithEmailAndPassword() {}
    export async function updateEmail() {}
    export async function updatePassword() {}
    export async function updateProfile() {}`,
  "firebase/firestore": `const state = globalThis.__firebaseRegistrationTest;
    export const deleteField = () => null, serverTimestamp = () => 123;
    export const doc = (db, collection, uid) => ({collection, id: uid, path: collection + '/' + uid});
    export async function getDoc(reference) {
      if (!state.auth.currentUser?.uid || !state.tokenReady) throw new Error('Premature Firestore access');
      state.reads.push(reference.path);
      if (state.readError) throw state.readError;
      const data = state.documents.get(reference.path);
      return {exists: () => Boolean(data), data: () => data};
    }
    export const getDocFromCache = getDoc;
    export async function setDoc() {throw new Error('Unexpected standalone write');}
    export async function updateDoc() {}
    export function writeBatch() {
      const writes = [];
      return {set(reference, value) {writes.push({reference, value});}, async commit() {
        if (!state.auth.currentUser?.uid || !state.tokenReady) throw new Error('Premature Firestore write');
        for (const {reference, value} of writes) {
          assertUid(reference, value);
          state.documents.set(reference.path, value);
        }
        state.commits.push(writes);
      }};
    }
    function assertUid(reference, value) {
      if (value.uid !== state.auth.currentUser.uid ||
          (reference.collection === 'users' && reference.id !== state.auth.currentUser.uid)) {
        throw new Error('Profile UID does not match Firebase session');
      }
    }`,
};
const server = await createServer({
  configFile: false, server: { middlewareMode: true }, appType: "custom", logLevel: "silent",
  ssr: { noExternal: ["firebase"] },
  plugins: [{ name: "firebase-registration-test-services", enforce: "pre",
    resolveId(source) {
      const key = Object.keys(mocks).find((value) => source === value || source.endsWith(`/${value}`));
      if (key) return `\0firebase-registration-test:${key}`;
    },
    load(id) {if (id.startsWith("\0firebase-registration-test:")) return mocks[id.slice("\0firebase-registration-test:".length)];},
  }],
});
after(async () => {await server.close(); delete globalThis.__firebaseRegistrationTest;});
const { waitForFirebaseUserSession } = await server.ssrLoadModule("/src/app/services/firebaseSession.js");
const { signUpCustomerWithEmailPassword, loadOrCreateCustomerProfile } =
  await server.ssrLoadModule("/src/app/services/customerAccount.js");
const { signUpWithEmailPassword, formatFirebaseAuthError } = await server.ssrLoadModule("/src/app/services/firebaseAuth.js");
const { waitForCustomerRegistration } = await server.ssrLoadModule("/src/app/utils/customerRegistration.js");

test("registration waits for initialization, UID and token; restoration cannot race the profile write", async () => {
  const initialization = deferred();
  const token = deferred();
  const creation = deferred();
  let creationCalls = 0;
  const user = { uid: "new-customer", email: "customer@example.test", displayName: "Customer",
    async getIdToken() { await token.promise; state.tokenReady = true; return "valid-id-token"; } };
  state.auth.authStateReady = () => initialization.promise;
  state.createUser = () => { creationCalls += 1; creation.resolve(); return {user}; };
  const registration = signUpCustomerWithEmailPassword({ fullName: "Customer", email: user.email,
    password: "Test123!", username: "chosen_username" });
  await pause(20);
  assert.equal(creationCalls, 0);
  state.persistence.resolve();
  await pause(20);
  assert.equal(creationCalls, 0);
  initialization.resolve();
  await Promise.race([creation.promise, registration.then(() => assert.fail("Registration completed before account creation"))]);
  await pause(20);
  assert.equal(state.reads.length, 0);
  state.auth.currentUser = user;
  for (const callback of [...state.listeners]) callback(user);
  const restoration = waitForCustomerRegistration();
  await pause(20);
  assert.equal(state.reads.length, 0);
  token.resolve();
  const [result] = await Promise.all([registration, restoration]);
  assert.equal(result.profile.uid, user.uid);
  assert.equal(result.profile.verificationStatus, "pending");
  assert.equal(state.apiCalls, 1);
  assert.equal(state.commits.length, 0);
  assert.equal(state.reads.length, 0);
  assert.equal(state.auth.currentUser, null);
  assert.equal(state.documents.get(`users/${user.uid}`).username, "chosen_username");
  assert.equal(state.documents.has("usernames/customer"), false);
  assert.equal(state.listeners.size, 0);
});

test("registration rejects an API profile belonging to another UID without reading Firestore", async () => {
  const user = { uid: 'second-customer', email: 'second@example.test', getIdToken: async () => 'valid-id-token' };
  state.auth.authStateReady = async () => {};
  state.createUser = () => {state.auth.currentUser = user; return {user};};
  state.invalidResponse = {uid: 'other-customer'};
  const reads = state.reads.length;
  try {
    await assert.rejects(signUpCustomerWithEmailPassword({fullName: 'Customer', email: user.email,
      password: 'Test123!', username: 'second_customer'}), /did not return a profile/);
    assert.equal(state.reads.length, reads);
    assert.equal(state.auth.currentUser, null);
  } finally {state.invalidResponse = null;}
});

test("both Firebase signup helpers validate every attempt before creation and preserve an existing session on rejection", async () => {
  const existing = state.auth.currentUser;
  const reads = state.reads.length;
  const commits = state.commits.length;
  const checks = state.validationChecks.length;
  state.createUser = () => assert.fail("A rejected email must never create a Firebase account");
  for (const signUp of [signUpCustomerWithEmailPassword, signUpWithEmailPassword]) {
    for (let attempt = 0; attempt < 3; attempt++) {
      await assert.rejects(signUp({
        fullName: "Customer", email: "same@yzcalo.com", password: "Test123!",
        username: "chosen_username", phone: "09620614953", registrationIp: "previous-approved-ip",
      }), { message: "Temporary or disposable email addresses are not allowed" });
    }
  }
  assert.equal(state.validationChecks.length, checks + 6);
  assert.equal(state.auth.currentUser, existing);
  assert.equal(state.reads.length, reads);
  assert.equal(state.commits.length, commits);
});

test("signup preserves backend SMTP and network failures instead of reporting Firestore offline", async () => {
  const message = 'Unable to connect to the email server. Check SMTP host, port, TLS settings, and outbound network access.';
  const smtpFailure = Object.assign(new Error('Request failed with status code 503'), {
    response: {status: 503, data: {message, details: {code: 'MAIL_DELIVERY_FAILED', stage: 'email-verification', smtpCode: 'ETIMEDOUT'}}},
  });
  for (const failure of [smtpFailure, Object.assign(new Error('Network Error'), {code: 'ERR_NETWORK'})]) {
    const user = {uid: 'failed-signup', email: 'failed@example.test', getIdToken: async () => 'valid-id-token'};
    state.createUser = () => {state.auth.currentUser = user; return {user};};
    state.apiError = failure;
    const reads = state.reads.length;
    try {
      await assert.rejects(signUpCustomerWithEmailPassword({fullName: 'Customer', email: user.email,
        password: 'Test123!', username: 'failed_customer'}), error => {
        assert.equal(error.code, 'customer/registration-request-failed');
        assert.equal(error.context, 'customer-registration-profile');
        assert.equal(error.statusCode, failure.response?.status || 0);
        assert.equal(error.message, failure.response?.data?.message || failure.message);
        assert.equal(formatFirebaseAuthError(error), error.message);
        assert.doesNotMatch(error.message, /Firestore/);
        if (failure.response) assert.equal(error.details.smtpCode, 'ETIMEDOUT');
        return true;
      });
      assert.equal(state.reads.length, reads);
      assert.equal(state.auth.currentUser, null);
    } finally {state.apiError = null;}
  }
});

test("profile loading still identifies real Firestore connectivity and permission failures", async () => {
  const user = {uid: 'profile-reader', email: 'reader@example.test', getIdToken: async () => 'valid-id-token'};
  state.auth.currentUser = user;
  state.tokenReady = true;
  for (const code of ['unavailable', 'permission-denied']) {
    state.readError = Object.assign(new Error('Firebase read failed'), {code});
    try {
      await assert.rejects(loadOrCreateCustomerProfile(user), error => {
        assert.equal(error.code, code === 'unavailable' ? 'firestore/offline' : code);
        assert.match(error.message, code === 'unavailable' ? /could not load or save/ : /permissions|signed-in/);
        return true;
      });
    } finally {state.readError = null;}
  }
  state.auth.currentUser = null;
});

test("session readiness rejects token failures, null sessions, and account switches", async () => {
  state.auth.authStateReady = async () => {};
  state.auth.currentUser = {uid: "broken-token", getIdToken: async () => {throw new Error("Token failed");}};
  assert.equal(await waitForFirebaseUserSession("broken-token", {timeoutMs: 25, settleMs: 0}), null);
  state.auth.currentUser = null;
  assert.equal(await waitForFirebaseUserSession("missing", {timeoutMs: 25, settleMs: 0}), null);
  const user = {uid: "old-user", async getIdToken() {
    state.auth.currentUser = {uid: "new-user"}; return "old-token";
  }};
  state.auth.currentUser = user;
  assert.equal(await waitForFirebaseUserSession("old-user", {timeoutMs: 25, settleMs: 0}), null);
  state.auth.currentUser = {uid: "signed-out", async getIdToken() {state.auth.currentUser = null; return "old-token";}};
  assert.equal(await waitForFirebaseUserSession("signed-out", {timeoutMs: 25, settleMs: 0}), null);
  assert.equal(state.listeners.size, 0);
});
