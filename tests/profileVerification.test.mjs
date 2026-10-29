import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";

test("customer profile writes require correct password even without the optional UI flag", async () => {
  const source = readFileSync(new URL("../src/app/services/customerAccount.js", import.meta.url), "utf8");
  const verification = source.slice(source.indexOf("export async function verifyCustomerPassword"), source.indexOf("export async function changeCustomerPassword"));
  const update = source.slice(source.indexOf("export async function updateCustomerProfile"));
  let writes = 0;
  const user = { uid: "customer", email: "customer@example.com", fullName: "Customer", username: "customer", phone: "phone" };
  const context = {
    ensureCustomerFirebaseReady() {}, auth: { currentUser: user },
    waitForFirebaseUserSession: async () => user, customerProfileReference: () => ({}),
    buildCustomerProfile: (_user, data) => data, normalizeString: (value = "") => value.trim(),
    normalizeEmail: (value = "") => value.trim().toLowerCase(), assertCustomerUsername: (value) => value,
    EmailAuthProvider: { credential: (email, password) => ({ email, password }) },
    reauthenticateWithCredential: async (_user, credential) => { if (credential.password !== "correct-password") throw new Error("Incorrect password"); },
    console: { info() {}, error() {} },
    writeCustomerProfileSnapshot: async () => { writes++; }, deleteField: () => null,
    normalizeAccountStatus: () => "active", serverTimestamp: () => "timestamp", updateFirebaseProfile: async () => {},
    loadOrCreateCustomerProfile: async () => user, normalizeCustomerServiceError: (error) => error,
    buildFirebaseErrorDetails: () => ({}),
  };
  vm.createContext(context);
  vm.runInContext(`${verification}\n${update}`.replaceAll("export async function", "async function"), context);
  for (const password of ["", "wrong-password"]) {
    await assert.rejects(context.updateCustomerProfile(user, { fullName: "Changed", verificationPassword: password }));
    assert.equal(writes, 0);
  }
  await context.updateCustomerProfile(user, { fullName: "Changed", verificationPassword: "correct-password" });
  assert.equal(writes, 1);
});
