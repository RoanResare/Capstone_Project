const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const { ApiError } = require("../src/utils/ApiError");

function fixture(options = {}) {
  const records = new Map();
  let sent = 0;
  let deleted = 0;
  let generated = 0;
  const db = {
    collection(name) { return { name, doc(id) {
      const key = `${name}/${id}`;
      return { key, id, async update(value) { records.set(key, { ...records.get(key), ...value }); } };
    } }; },
    async runTransaction(action) {
      if (options.databaseError) throw options.databaseError;
      const pending = [];
      await action({
        get: async ref => ({ exists: records.has(ref.key), data: () => records.get(ref.key) }),
        set: (ref, value, opts = {}) => pending.push(() => records.set(ref.key,
          opts.merge ? { ...records.get(ref.key), ...value } : value)),
        delete: ref => pending.push(() => records.delete(ref.key)),
      });
      pending.forEach(write => write());
    },
  };
  const filename = path.resolve(__dirname, "../src/controllers/registration.controller.js");
  const controller = new Module(filename, module);
  controller.filename = filename;
  controller.paths = module.paths;
  const originalRequire = controller.require.bind(controller);
  controller.require = id => {
    if (id === "../config/postgresDatabase") return { db };
    if (id === "../config/env") return { env: { runtime: { supabaseAdminReady: !options.noSupabase, mailDeliveryReady: true },
      auth: { emailVerificationUrl: "https://clinic.example/activate-account" } } };
    if (id === "../services/registrationSecurity.service") return { validateRegistrationSecurity: async () => ({ registrationIp: "test-ip" }) };
    if (id === "../services/sessionSecurity.service") return { validateAccessSecurity: async () => {} };
    if (id === "../services/supabaseAuth.service") return {
      async generateSupabaseEmailLink() {
        generated++;
        if (options.linkError) throw options.linkError;
        return { actionLink: "https://project.supabase.co/auth/v1/verify?token=opaque", tokenHash: "opaque-token-hash",
          user: { id: "verified-uid", email: "customer@gmail.com" } };
      },
      async deleteSupabaseUser(uid) { assert.equal(uid, "verified-uid"); deleted++; if (options.deleteError) throw options.deleteError; },
      findSupabaseUserByEmail: async () => null,
    };
    if (id === "../services/token.service") return { signCustomerVerificationStatusToken: () => "status-challenge" };
    if (id === "../services/mail.service") return { async sendEmailVerificationLink(payload) {
      sent++;
      assert.equal(payload.to, "customer@gmail.com");
      if (options.mailError) throw options.mailError;
      return { messageId: "resend-id" };
    } };
    if (id === "../services/phoneAccounts.service") return { findPhoneAccounts: async () => [], PHONE_ACCOUNT_LIMIT: 3, PHONE_ACCOUNT_LIMIT_MESSAGE: "Phone limit reached." };
    if (id === "../services/user.service") return {
      assertValidUsername: value => value,
      findUserByEmailCaseInsensitive: async () => null,
      getUsernameOwner: async () => null,
    };
    if (id === "../utils/emailValidation") return { assertValidEmail() {} };
    if (id === "../utils/password") return { assertStrongPassword() {} };
    if (id === "../utils/phoneNumber") return { normalizePhilippineMobileNumber: value => value.replace(/\D/g, "").replace(/^63/, "0"), PH_MOBILE_ERROR: "Invalid phone" };
    return originalRequire(id);
  };
  controller._compile(fs.readFileSync(filename, "utf8"), filename);
  const response = { status(value) { this.statusCode = value; return this; }, json(value) { this.body = value; return this; } };
  const request = () => ({ body: { uid: "forged-uid", email: "Customer@gmail.com", password: "Valid!Password1",
    fullName: "Customer", username: "new_customer", phone: "9940702702" }, ip: "127.0.0.1", headers: {} });
  return { records, response, handler: controller.exports.createCustomerProfile,
    get sent() { return sent; }, get generated() { return generated; }, get deleted() { return deleted; },
    run: () => controller.exports.createCustomerProfile(request(), response) };
}

test("signup links the profile to the Supabase Auth identity, ignoring a forged client UID", async () => {
  const system = fixture();
  await system.run();
  assert.equal(system.response.statusCode, 202);
  assert.equal(system.response.body.profile.uid, "verified-uid");
  assert.equal(system.response.body.profile.authUserId, "verified-uid");
  assert.equal(system.records.get("users/verified-uid").email, "customer@gmail.com");
  assert.equal(system.records.has("users/forged-uid"), false);
  assert.equal(system.sent, 1);
  assert.equal(system.generated, 1);
});

test("a Resend failure leaves the new account pending so the customer can request another link", async () => {
  const system = fixture({ mailError: new ApiError(503, "Resend unavailable", { code: "MAIL_DELIVERY_FAILED" }) });
  await system.run();
  assert.equal(system.response.statusCode, 202);
  assert.equal(system.response.body.deliveryStatus, "pending");
  assert.equal(system.records.get("users/verified-uid").verificationStatus, "pending");
  assert.equal(system.sent, 1);
});

test("Supabase and configuration failures never save a pending customer profile", async () => {
  const authError = Object.assign(new Error("Supabase unavailable"), { statusCode: 503 });
  await assert.rejects(fixture({ linkError: authError }).run(), error => error === authError);
  await assert.rejects(fixture({ noSupabase: true }).run(), error => error.statusCode === 503);
});

test("profile transaction failure triggers best-effort cleanup of the newly created Supabase identity", async () => {
  const databaseError = new Error("PostgreSQL unavailable");
  const system = fixture({ databaseError, deleteError: new Error("cleanup unavailable") });
  await assert.rejects(system.run(), error => error === databaseError);
  assert.equal(system.records.size, 0);
  assert.equal(system.deleted, 1);
});

test("POST signup returns a pending profile or retryable email delivery status through Express", async () => {
  const express = require("express");
  const { asyncHandler } = require("../src/utils/asyncHandler");
  const { errorHandler } = require("../src/middlewares/errorHandler");
  for (const mailError of [null, new ApiError(503, "Resend unavailable", { code: "MAIL_DELIVERY_FAILED" })]) {
    const system = fixture({ mailError });
    const app = express();
    app.use(express.json());
    app.post("/api/auth/register/profile", asyncHandler(system.handler));
    app.use(errorHandler);
    const server = await new Promise(resolve => { const listener = app.listen(0, "127.0.0.1", () => resolve(listener)); });
    try {
      const response = await fetch(`http://127.0.0.1:${server.address().port}/api/auth/register/profile`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "Customer@gmail.com", password: "Valid!Password1", fullName: "Customer", username: "new_customer", phone: "9940702702" }),
      });
      const body = await response.json();
      assert.equal(response.status, 202);
      if (mailError) assert.equal(body.deliveryStatus, "pending");
      else assert.equal(body.profile.uid, "verified-uid");
    } finally { await new Promise(resolve => server.close(resolve)); }
  }
});
