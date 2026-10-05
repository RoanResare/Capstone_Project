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
const { signUpWithEmailPassword } = await server.ssrLoadModule("/src/app/services/firebaseAuth.js");

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
  const restoration = loadOrCreateCustomerProfile(user);
  await pause(20);
  assert.equal(state.reads.length, 0);
  token.resolve();
  const [result, restored] = await Promise.all([registration, restoration]);
  assert.equal(result.profile.uid, user.uid);
  assert.equal(restored.username, "chosen_username");
  assert.equal(state.commits.length, 1);
  assert.equal(state.documents.get(`users/${user.uid}`).username, "chosen_username");
  assert.equal(state.documents.has("usernames/customer"), false);
  assert.equal(state.listeners.size, 0);
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
