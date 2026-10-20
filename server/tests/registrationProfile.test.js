const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const { ApiError } = require("../src/utils/ApiError");

function fixture(options = {}) {
  const records = new Map();
  let sent = 0;
  let transactions = 0;
  const db = {
    collection(name) { return { name, doc(id) {
      const key = `${name}/${id}`;
      return { key, async update(value) {
        if (options.metadataError) throw options.metadataError;
        records.set(key, { ...records.get(key), ...value });
      } };
    } }; },
    async runTransaction(action) {
      transactions++;
      if (options.rollbackError && transactions > 1) throw options.rollbackError;
      if (options.firestoreError) throw options.firestoreError;
      const writes = [];
      await action({
        get: async ref => ({ exists: records.has(ref.key), data: () => records.get(ref.key) }),
        set: (ref, value) => writes.push(() => records.set(ref.key, value)),
        delete: ref => writes.push(() => records.delete(ref.key)),
      });
      writes.forEach(write => write());
    },
  };
  const filename = path.resolve(__dirname, "../src/controllers/registration.controller.js");
  const controller = new Module(filename, module);
  controller.filename = filename;
  controller.paths = module.paths;
  const originalRequire = controller.require.bind(controller);
  controller.require = id => {
    if (id === "../config/firebaseAdmin") return { db, auth: options.noAuth ? null : {
      async verifyIdToken() {
        if (options.tokenError) throw options.tokenError;
        return {uid: "verified-uid", email: "customer@gmail.com"};
      },
    } };
    if (id === "../config/env") return { env: {auth: {emailVerificationUrl: "https://clinic.example/activate-account"}} };
    if (id === "../services/registrationSecurity.service") return {validateRegistrationSecurity: async () => ({registrationIp: "test"})};
    if (id === "../services/sessionSecurity.service") return {validateAccessSecurity: async () => {}};
    if (id === "../services/phoneAccounts.service") return {findPhoneAccounts: async () => [], PHONE_ACCOUNT_LIMIT: 3};
    if (id === "../services/firebaseAuth.service") return {generateEmailVerificationLink: async () => {
      if (options.linkError) throw options.linkError;
      return "https://firebase.example/action?oobCode=test-code";
    } };
    if (id === "../services/mail.service") return {sendEmailVerificationLink: async () => {
      if (options.mailError) throw options.mailError;
      sent++;
    } };
    return originalRequire(id);
  };
  controller._compile(fs.readFileSync(filename, "utf8"), filename);
  const response = {status(value) {this.statusCode = value; return this;}, json(value) {this.body = value; return this;} };
  return {records, response, handler: controller.exports.createCustomerProfile, get sent() {return sent;}, run: () => controller.exports.createCustomerProfile({
    headers: {authorization: "Bearer test-token"},
    body: {uid: "forged-uid", email: "forged@gmail.com", fullName: "Customer", username: "new_customer", phone: "9940702702"},
  }, response)};
}

test("registration saves the verified token UID and returns the pending profile without client Firestore", async () => {
  const system = fixture();
  await system.run();
  assert.equal(system.response.statusCode, 202);
  assert.equal(system.response.body.profile.uid, "verified-uid");
  assert.equal(system.records.get("users/verified-uid").email, "customer@gmail.com");
  assert.equal(system.records.has("users/forged-uid"), false);
  assert.equal(system.sent, 1);
});

test("a delivery timestamp write failure cannot erase a profile after its activation email was sent", async () => {
  const system = fixture({metadataError: Object.assign(new Error("Firestore unavailable"), {code: 14})});
  await system.run();
  assert.equal(system.response.statusCode, 202);
  assert.equal(system.sent, 1);
  assert.equal(system.records.get("users/verified-uid").verificationStatus, "pending");
  assert.ok(system.records.get("users/verified-uid").verificationExpiresAt instanceof Date);
});

test("Resend failures preserve the real error and roll back the pending profile", async () => {
  const error = new ApiError(503, "Resend network connection timed out", {code: "MAIL_DELIVERY_FAILED"});
  const system = fixture({mailError: error});
  await assert.rejects(system.run(), e => e === error);
  assert.equal(system.records.size, 0);
});

test("Firebase infrastructure failures are 503 while invalid customer tokens are 401", async () => {
  for (const [code, status] of [["auth/id-token-expired", 401], ["auth/id-token-revoked", 401], ["auth/network-request-failed", 503]]) {
    const system = fixture({tokenError: Object.assign(new Error("Token verification failed"), {code})});
    await assert.rejects(system.run(), error => error.statusCode === status && error.details.stage === "firebase-auth");
    assert.equal(system.records.size, 0);
  }
  await assert.rejects(fixture({noAuth: true}).run(), error => error.statusCode === 503);
});

test("profile storage and verification link failures identify their distinct stages", async () => {
  for (const [option, stage] of [["firestoreError", "profile-save"], ["linkError", "verification-link"]]) {
    const system = fixture({[option]: Object.assign(new Error("Dependency unavailable"), {code: 14})});
    await assert.rejects(system.run(), error => error.statusCode === 503 && error.details.stage === stage);
    assert.equal(system.sent, 0);
    assert.equal(system.records.size, 0);
  }
});

test("rollback errors cannot hide the original mail delivery failure", async () => {
  const original = new ApiError(503, "Resend connection failed");
  const system = fixture({mailError: original, rollbackError: new Error("Firestore unavailable")});
  await assert.rejects(system.run(), error => error === original && error.details.stage === "email-verification");
});

test("POST registration returns the pending profile or the original Resend failure through Express", async () => {
  const express = require("express");
  const { asyncHandler } = require("../src/utils/asyncHandler");
  const { errorHandler } = require("../src/middlewares/errorHandler");
  for (const mailError of [null, new ApiError(503, "Resend network unavailable", {code: "MAIL_DELIVERY_FAILED"})]) {
    const system = fixture({mailError});
    const app = express();
    app.use(express.json());
    app.post("/api/auth/register/profile", asyncHandler(system.handler));
    app.use(errorHandler);
    const server = await new Promise(resolve => {const listener = app.listen(0, "127.0.0.1", () => resolve(listener));});
    try {
      const response = await fetch(`http://127.0.0.1:${server.address().port}/api/auth/register/profile`, {
        method: "POST", headers: {"Content-Type": "application/json", Authorization: "Bearer test-token"},
        body: JSON.stringify({fullName: "Customer", username: "new_customer", phone: "9940702702"}),
      });
      const body = await response.json();
      assert.equal(response.status, mailError ? 503 : 202);
      if (mailError) {
        assert.equal(body.message, mailError.message);
        assert.equal(body.details.stage, "email-verification");
      } else assert.equal(body.profile.uid, "verified-uid");
    } finally {await new Promise(resolve => server.close(resolve));}
  }
});
