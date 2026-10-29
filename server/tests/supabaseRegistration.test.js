const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");

function loadRegistration(options = {}) {
  const records = new Map();
  const pendingWrites = [];
  let authCreated = 0;
  let authLookups = 0;
  let authDeleted = 0;
  const db = {
    collection(name) {
      return { doc(id) { return { id, key: `${name}/${id}` }; } };
    },
    async runTransaction(run) {
      await run({
        get: async (ref) => ({ exists: records.has(ref.key), data: () => records.get(ref.key) }),
        set: (ref, value) => pendingWrites.push([ref.key, value]),
        delete: (ref) => pendingWrites.push([ref.key, null]),
      });
      for (const [key, value] of pendingWrites.splice(0)) {
        if (value === null) records.delete(key);
        else records.set(key, value);
      }
    },
  };
  const filename = path.resolve(__dirname, "../src/controllers/registration.controller.js");
  const controller = new Module(filename, module);
  controller.filename = filename;
  controller.paths = module.paths;
  const originalRequire = controller.require.bind(controller);
  controller.require = (id) => {
    if (id === "../config/postgresDatabase") return { db };
    if (id === "../config/env") return { env: {
      runtime: { supabaseAdminReady: true, mailDeliveryReady: true },
      auth: { emailVerificationUrl: "https://clinic.example/activate-account" },
    } };
    if (id === "../utils/ApiError") return require("../src/utils/ApiError");
    if (id === "../services/registrationSecurity.service") return { validateRegistrationSecurity: async () => ({ registrationIp: "127.0.0.1" }) };
    if (id === "../services/sessionSecurity.service") return { validateAccessSecurity: async () => ({}) };
    if (id === "../services/supabaseAuth.service") return {
      findSupabaseUserByEmail: async () => {
        authLookups += 1;
        return authLookups === 1 ? options.authUser || null : options.fallbackAuthUser || null;
      },
      generateSupabaseEmailLink: async () => {
        authCreated += 1;
        if (options.triggerProfile) records.set("users/7caeb3fd-d955-49cb-a8d9-17f0e75d8620", {
          uid: "7caeb3fd-d955-49cb-a8d9-17f0e75d8620", email: "customer@example.com",
          role: "customer", accountStatus: "active", createdAt: new Date().toISOString(),
          ...options.triggerProfile,
        });
        return options.challenge || { user: { id: "7caeb3fd-d955-49cb-a8d9-17f0e75d8620" }, tokenHash: "opaque-token-hash" };
      },
      deleteSupabaseUser: async () => { authDeleted += 1; }, verifySupabaseEmailToken: async () => ({}),
    };
    if (id === "../services/mail.service") return { sendEmailVerificationLink: async () => ({ messageId: "mail-id" }) };
    if (id === "../services/phoneAccounts.service") return { findPhoneAccounts: async () => [], PHONE_ACCOUNT_LIMIT: 3, PHONE_ACCOUNT_LIMIT_MESSAGE: "Phone limit reached." };
    if (id === "../utils/phoneNumber") return { normalizePhilippineMobileNumber: (value) => value ? "+63 9940702702" : "", PH_MOBILE_ERROR: "Invalid phone." };
    if (id === "../utils/password") return { hashPassword: () => "scrypt-hash", assertStrongPassword: () => {} };
    if (id === "../services/user.service") return {
      assertValidUsername: (value) => value,
      findUserByEmailCaseInsensitive: async () => options.profile || null,
      getUsernameOwner: async () => options.usernameOwner || null,
    };
    return originalRequire(id);
  };
  controller._compile(fs.readFileSync(filename, "utf8"), filename);
  const response = { status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
  return {
    records, response, get authCreated() { return authCreated; }, get authDeleted() { return authDeleted; },
    run: () => controller.exports.createCustomerProfile({ body: {
      fullName: "Survey Customer", email: "customer@example.com", username: "survey_customer",
      phone: "+63 9940702702", password: "Valid!Pass123",
    }, ip: "127.0.0.1" }, response),
  };
}

test("customer registration creates a Supabase identity and a complete PostgreSQL profile payload without a second password hash", async () => {
  const fixture = loadRegistration();
  await fixture.run();
  const profile = fixture.records.get("users/7caeb3fd-d955-49cb-a8d9-17f0e75d8620");
  assert.equal(fixture.response.statusCode, 202);
  assert.equal(profile.email, "customer@example.com");
  assert.equal(profile.username, "survey_customer");
  assert.equal(profile.phone, "+63 9940702702");
  assert.equal(profile.authUserId, "7caeb3fd-d955-49cb-a8d9-17f0e75d8620");
  assert.equal(profile.role, "customer");
  assert.equal(profile.accountStatus, "inactive");
  assert.equal(Object.hasOwn(profile, "passwordHash"), false);
  assert.equal(fixture.records.get("usernames/survey_customer").uid, profile.uid);
  assert.equal(fixture.authCreated, 1);
});

test("registration completes the matching profile created by an Auth INSERT trigger", async () => {
  const fixture = loadRegistration({ triggerProfile: {} });
  await fixture.run();
  const profile = fixture.records.get("users/7caeb3fd-d955-49cb-a8d9-17f0e75d8620");
  assert.equal(fixture.response.statusCode, 202);
  assert.equal(profile.username, "survey_customer");
  assert.equal(profile.verificationStatus, "pending");
  assert.equal(profile.accountStatus, "inactive");
  assert.equal(fixture.authDeleted, 0);
});

test("conflicting, old or verified profiles are preserved when registration is rejected", async () => {
  for (const triggerProfile of [
    { email: "someone-else@example.com" },
    { createdAt: "2020-01-01T00:00:00Z" },
    { emailVerified: true }, { role: "admin" }, { username: "another_name" },
  ]) {
    const fixture = loadRegistration({ triggerProfile });
    await assert.rejects(fixture.run(), (error) => error.statusCode === 409);
    assert.equal(fixture.records.size, 1);
    assert.equal(fixture.authDeleted, 0);
  }
});

test("existing Supabase emails and usernames are rejected before Auth provisioning", async () => {
  for (const options of [{ authUser: { id: "existing", email: "CUSTOMER@example.com" } }, { usernameOwner: { uid: "existing" } }]) {
    const fixture = loadRegistration(options);
    await assert.rejects(fixture.run(), (error) => error.statusCode === 409);
    assert.equal(fixture.authCreated, 0);
  }
});

test("a PostgreSQL duplicate profile is rejected before provisioning another Auth identity", async () => {
  const fixture = loadRegistration({ profile: { uid: "existing-profile", email: "customer@example.com" } });
  await assert.rejects(fixture.run(), (error) => error.statusCode === 409);
  assert.equal(fixture.authCreated, 0);
  assert.equal(fixture.records.size, 0);
});

test("unrelated profile and Auth lookup candidates cannot block a unique registration", async () => {
  const fixture = loadRegistration({
    profile: { uid: "unrelated-profile", email: "other@example.com" },
    authUser: { id: "unrelated-auth", email: "prefix-customer@example.com" },
  });
  await fixture.run();
  assert.equal(fixture.response.statusCode, 202);
  assert.equal(fixture.authCreated, 1);
});

test("registration resolves the Auth UUID by email when the signup challenge omits its user object", async () => {
  const uid = "4fed59af-ea29-47ae-9b36-0ee6363f76d0";
  const fixture = loadRegistration({
    challenge: { tokenHash: "opaque-token-hash", actionLink: "https://auth.example/verify" },
    fallbackAuthUser: { id: uid, email: "customer@example.com" },
  });
  await fixture.run();
  const profile = fixture.records.get(`users/${uid}`);
  assert.equal(fixture.response.statusCode, 202);
  assert.equal(profile.uid, uid);
  assert.equal(profile.authUserId, uid);
});

test("authentication middleware has no Firebase token fallback", async () => {
  const filename = path.resolve(__dirname, "../src/middlewares/authenticate.js");
  const middlewareModule = new Module(filename, module);
  middlewareModule.filename = filename;
  middlewareModule.paths = module.paths;
  const originalRequire = middlewareModule.require.bind(middlewareModule);
  middlewareModule.require = (id) => {
    if (id === "../config/env") return { env: { auth: { jwtSecret: "test-secret" } } };
    if (id === "../services/token.service") return { verifyAccessToken: () => { throw Object.assign(new Error("Invalid token"), { statusCode: 401 }); } };
    if (id === "../services/sessionSecurity.service") return { validateSessionSecurity: async () => {} };
    if (id === "../services/user.service") return { getUserByAuthId: async () => null, getUserByUid: async () => null, toPublicUser: (user) => user };
    if (id === "../constants/auth") return { FRAUD_STATUSES: { SUSPENDED: "suspended", BANNED: "banned" }, USER_STATUSES: { ACTIVE: "active" } };
    if (id === "../utils/ApiError") return { ApiError: class ApiError extends Error { constructor(statusCode, message) { super(message); this.statusCode = statusCode; } } };
    if (id === "../services/supabaseAuth.service") return { isSupabaseAccessToken: () => false, verifySupabaseAccessToken: async () => null };
    return originalRequire(id);
  };
  middlewareModule._compile(fs.readFileSync(filename, "utf8"), filename);
  const { verifyToken } = middlewareModule.exports;
  let nextError;
  await verifyToken({ headers: { authorization: "Bearer firebase-style-token" } }, {}, (error) => { nextError = error; });
  assert.equal(nextError?.statusCode, 401);
});
