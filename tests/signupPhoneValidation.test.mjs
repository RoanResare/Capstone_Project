import assert from "node:assert/strict";
import { after, test } from "node:test";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { createServer } from "vite";

const mocks = {
  "firebase/auth": "export const browserLocalPersistence = {}, browserSessionPersistence = {}; export function onAuthStateChanged() {} export function signInWithCustomToken() {} export function signOut() {} export function setPersistence() {}",
  "firebase.js": "export const auth = {}, firebaseConfigError = '', isFirebaseConfigured = true;",
  "services/firebaseAuth.js": "export function formatFirebaseAuthError(error) {return error.message;} export function isFirebaseConnectionIssue() {} export function loadExistingUserProfile() {} export function signInWithEmailPassword() {} export function updateFirebaseUserProfile() {}",
  "services/customerAccount.js": "export function loadOrCreateCustomerProfile() {} export function signInCustomerWithEmailPassword() {} export function updateCustomerProfile() {} export async function signUpCustomerWithEmailPassword(data) {globalThis.__signupPhoneTestCalls.push(data); return {firebaseUser: {getIdToken: async () => 'test-token'}, profile: {uid: 'customer-id', role: 'customer'}};}",
  "services/authApi.js": "export async function checkCustomerRegistrationAvailability(data) {globalThis.__signupPhoneTestChecks.push(data); return {};} export function completeBackendPasswordReset() {} export function loginUnifiedUser() {} export function loginPortalUser() {} export function requestBackendPasswordReset() {} export function resendPortalOtp() {} export function validateBackendPasswordResetCode() {} export function verifyPortalOtp() {}",
};
const server = await createServer({
  configFile: false, server: { middlewareMode: true }, appType: "custom", logLevel: "silent",
  plugins: [{ name: "signup-phone-test-services", enforce: "pre",
    resolveId(source) {
      const key = Object.keys(mocks).find((value) => source === value || source.endsWith(`/${value}`));
      if (key) return `\0signup-phone-test:${key}`;
    },
    load(id) { if (id.startsWith("\0signup-phone-test:")) return mocks[id.slice("\0signup-phone-test:".length)]; },
  }],
});
after(async () => {
  await server.close();
  delete globalThis.__signupPhoneTestCalls;
  delete globalThis.__signupPhoneTestChecks;
});
const { AuthProvider, useAuth } = await server.ssrLoadModule("/src/app/context/AuthContext.jsx");

test("the actual signup handler accepts +63 and local formats and stores the same normalized number", async () => {
  globalThis.__signupPhoneTestCalls = [];
  globalThis.__signupPhoneTestChecks = [];
  let signUp;
  function CaptureSignup() { signUp = useAuth().signUp; return null; }
  renderToString(createElement(AuthProvider, null, createElement(CaptureSignup)));
  for (const phone of ["+63 9620614953", "09620614953", "9620614953"]) {
    const result = await signUp({ fullName: "Test Customer", email: "customer@example.test", username: "customer",
      phone, password: "Test123!", confirmPassword: "Test123!" });
    assert.equal(result.ok, true, result.error);
    assert.equal(result.homePath, "/customer/dashboard");
    assert.equal(globalThis.__signupPhoneTestCalls.at(-1).phone, "+63 9620614953");
    assert.equal(globalThis.__signupPhoneTestChecks.at(-1).phone, "+63 9620614953");
  }
  const count = globalThis.__signupPhoneTestCalls.length;
  const result = await signUp({ fullName: "Test Customer", email: "customer@example.test", username: "customer",
    phone: "+63 96206149530", password: "Test123!", confirmPassword: "Test123!" });
  assert.equal(result.ok, false);
  assert.equal(globalThis.__signupPhoneTestCalls.length, count);
});
