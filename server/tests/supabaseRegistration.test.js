const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const { Timestamp } = require("../src/database/values");

function loadRegistration(options = {}) {
  const records = new Map();
  const pendingWrites = [];
  let authCreated = 0;
  let authLookups = 0;
  let authDeleted = 0;
  let signupMetadata;
  let profileLookups = 0;
  const db = {
    collection(name) {
      return { doc(id) { return { id, key: `${name}/${id}`,
        async update(value) { records.set(`${name}/${id}`, { ...records.get(`${name}/${id}`), ...value }); },
      }; } };
    },
    async runTransaction(run) {
      await run({
        get: async (ref) => ({ exists: records.has(ref.key), data: () => records.get(ref.key) }),
        set: (ref, value, settings) => pendingWrites.push([ref.key, settings?.merge ? { ...records.get(ref.key), ...value } : value]),
        update: (ref, value) => pendingWrites.push([ref.key, { ...records.get(ref.key), ...value }]),
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
        return authLookups === 1 ? options.authUser || (options.existingPending ? { id: "7caeb3fd-d955-49cb-a8d9-17f0e75d8620", email: "customer@example.com" } : null) : options.fallbackAuthUser || null;
      },
      generateSupabaseEmailLink: async (payload) => {
        signupMetadata = payload.userMetadata;
        if (!options.existingPending) authCreated += 1;
        if (options.triggerProfile) records.set(`users/${options.generatedProfile?.profileDocId || "7caeb3fd-d955-49cb-a8d9-17f0e75d8620"}`, {
          uid: "7caeb3fd-d955-49cb-a8d9-17f0e75d8620", email: "customer@example.com",
          role: "customer", accountStatus: "active", createdAt: new Date().toISOString(),
          ...options.triggerProfile,
        });
        return options.challenge || { user: { id: "7caeb3fd-d955-49cb-a8d9-17f0e75d8620" }, tokenHash: "opaque-token-hash", emailOtp: "012345", actionLink: "https://auth.example/verify?token_hash=opaque-token-hash" };
      },
      deleteSupabaseUser: async () => { authDeleted += 1; },
      verifySupabaseEmailToken: async (token, type) => {
        assert.equal(token, "opaque-token-hash"); assert.equal(type, "signup");
        if (options.invalidToken) throw new Error("Expired token");
        return { user: { id: "7caeb3fd-d955-49cb-a8d9-17f0e75d8620", email: "customer@example.com" } };
      },
      verifySupabaseEmailCode: async (email, otpCode) => {
        assert.equal(email, "customer@example.com");
        if (options.providerError) throw options.providerError;
        if (otpCode !== "012345") throw new Error("Invalid code");
        return { user: { id: "7caeb3fd-d955-49cb-a8d9-17f0e75d8620", email: options.verifiedEmail || email } };
      },
    };
    if (id === "../services/token.service") return {
      signCustomerVerificationStatusToken: (uid, nonce) => `status:${uid}:${nonce}`,
      verifyCustomerVerificationStatusToken: (token) => token === "valid-status" ? { uid: "7caeb3fd-d955-49cb-a8d9-17f0e75d8620", nonce: "nonce" } : null,
    };
    if (id === "../services/mail.service") return { sendEmailVerificationLink: async (payload) => {
      if (options.mailError) throw options.mailError;
      assert.equal(payload.to, "customer@example.com");
      assert.match(payload.verificationLink, /token_hash=opaque-token-hash/);
      return { messageId: "mail-id" };
    } };
    if (id === "../services/phoneAccounts.service") return { findPhoneAccounts: async () => [], PHONE_ACCOUNT_LIMIT: 3, PHONE_ACCOUNT_LIMIT_MESSAGE: "Phone limit reached." };
    if (id === "../utils/phoneNumber") return { normalizePhilippineMobileNumber: (value) => value ? "+63 9940702702" : "", PH_MOBILE_ERROR: "Invalid phone." };
    if (id === "../utils/password") return { hashPassword: () => "scrypt-hash", assertStrongPassword: () => {} };
    if (id === "../services/user.service") return {
      assertValidUsername: (value) => value,
      findUserByEmailCaseInsensitive: async () => ++profileLookups === 1 ? options.profile || null : options.generatedProfile || null,
      getUsernameOwner: async () => options.usernameOwner || null,
      getUserByEmail: async () => records.get("users/7caeb3fd-d955-49cb-a8d9-17f0e75d8620"),
    };
    return originalRequire(id);
  };
  controller._compile(fs.readFileSync(filename, "utf8"), filename);
  const response = { status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
  return {
    records, response, get authCreated() { return authCreated; }, get authDeleted() { return authDeleted; },
    get signupMetadata() { return signupMetadata; },
    activate: () => controller.exports.activateCustomerEmail({ body: { token_hash: "opaque-token-hash" } }, response),
    verifyCode: (otpCode = "012345") => controller.exports.activateCustomerEmail({ body: { email: "customer@example.com", otpCode } }, response),
    resend: () => controller.exports.resendCustomerEmailVerification({ body: { email: "customer@example.com" } }, response),
    run: () => controller.exports.createCustomerProfile({ body: {
      fullName: "Survey Customer", email: "customer@example.com", username: "survey_customer",
      phone: "+63 9940702702", password: "Valid!Pass123",
      ...options.payload,
    }, ip: "127.0.0.1" }, response),
  };
}

test("customer registration creates a Supabase identity and a complete PostgreSQL profile payload without a second password hash", async () => {
  const fixture = loadRegistration();
  await fixture.run();
  const profile = fixture.records.get("users/7caeb3fd-d955-49cb-a8d9-17f0e75d8620");
  assert.equal(fixture.response.statusCode, 202);
  assert.equal(profile.email, "customer@example.com");
  assert.equal(profile.fullName, "Survey Customer");
  assert.equal(fixture.signupMetadata.full_name, "Survey Customer");
  assert.equal(fixture.signupMetadata.role, "customer");
  assert.equal(profile.username, "survey_customer");
  assert.equal(profile.phone, "+63 9940702702");
  assert.equal(profile.authUserId, "7caeb3fd-d955-49cb-a8d9-17f0e75d8620");
  assert.equal(profile.role, "customer");
  assert.equal(profile.accountStatus, "inactive");
  assert.equal(Object.hasOwn(profile, "passwordHash"), false);
  assert.equal(fixture.records.get("usernames/survey_customer").uid, profile.uid);
  assert.equal(fixture.authCreated, 1);
});

test("customer signup preserves the submitted name and uses safe fallbacks when absent", async () => {
  for (const [payload, expected] of [
    [{ fullName: "  Roan Resare  " }, "Roan Resare"],
    [{ fullName: "", full_name: "Roan Resare" }, "Roan Resare"],
    [{ fullName: "   " }, "survey_customer"],
  ]) {
    const fixture = loadRegistration({ payload, triggerProfile: { fullName: "Staff User" } });
    await fixture.run();
    const profile = fixture.records.get("users/7caeb3fd-d955-49cb-a8d9-17f0e75d8620");
    assert.equal(profile.fullName, expected);
    assert.equal(fixture.signupMetadata.full_name, expected);
    assert.equal(fixture.signupMetadata.role, "customer");
  }
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

test("the corrected Auth trigger is side-effect-free and registration creates its own pending customer profile", async () => {
  const triggerMigration = fs.readFileSync(path.resolve(__dirname, "../../supabase/migrations/202611020001_disable_auth_profile_autoprovision.sql"), "utf8");
  assert.match(triggerMigration, /CREATE OR REPLACE FUNCTION public\.handle_new_user\(\)[\s\S]*?RETURN NEW;/);
  assert.doesNotMatch(triggerMigration, /INSERT\s+INTO\s+(?:public\.)?users/i);
  assert.doesNotMatch(triggerMigration, /ELSE\s+'staff'/i);

  // Supabase Auth creation no longer inserts a profile. The registration
  // controller writes the sole profile with a customer role and pending state.
  const fixture = loadRegistration();
  await fixture.run();
  const profiles = [...fixture.records.entries()].filter(([key]) => key.startsWith("users/"));
  assert.equal(profiles.length, 1);
  assert.equal(profiles[0][1].role, "customer");
  assert.equal(profiles[0][1].accountStatus, "inactive");
  assert.equal(profiles[0][1].verificationStatus, "pending");
  assert.equal(profiles[0][1].authUserId, profiles[0][1].uid);
});

test("registration accepts a fresh database Timestamp and nullable status without erasing trigger metadata", async () => {
  const fixture = loadRegistration({ triggerProfile: {
    createdAt: Timestamp.now(), status: null, accountStatus: null, preservedMetadata: "keep",
  } });
  await fixture.run();
  assert.equal(fixture.response.statusCode, 202);
  assert.equal(fixture.records.get("users/7caeb3fd-d955-49cb-a8d9-17f0e75d8620").preservedMetadata, "keep");
  assert.equal(fixture.authDeleted, 0);
});

test("fresh native profiles keep their document ID while linking and verifying the Auth UUID", async () => {
  const authId = "7caeb3fd-d955-49cb-a8d9-17f0e75d8620";
  const profileId = "native-profile-id";
  const fixture = loadRegistration({
    generatedProfile: { email: "customer@example.com", authUserId: authId, profileDocId: profileId, uid: profileId },
    triggerProfile: { uid: profileId, authUserId: authId },
  });
  await fixture.run();
  assert.equal(fixture.response.body.profile.uid, profileId);
  assert.equal(fixture.records.has(`users/${authId}`), false);
  assert.equal(fixture.records.get("usernames/survey_customer").uid, profileId);
  await fixture.verifyCode();
  const profile = fixture.records.get(`users/${profileId}`);
  assert.equal(profile.authUserId, authId);
  assert.equal(profile.accountStatus, "active");
  assert.equal(fixture.authDeleted, 0);
});

test("mail failure reports a created pending account and preserves its identity and profile", async () => {
  const fixture = loadRegistration({ mailError: new Error("Mail unavailable") });
  await fixture.run();
  assert.equal(fixture.response.statusCode, 202);
  assert.equal(fixture.response.body.deliveryStatus, "pending");
  assert.match(fixture.response.body.message, /account was created.*code could not be sent/);
  assert.equal(fixture.authDeleted, 0);
  assert.equal(fixture.authCreated, 1);
  assert.equal(fixture.records.get("users/7caeb3fd-d955-49cb-a8d9-17f0e75d8620").accountStatus, "inactive");
});

test("valid activation links activate the matching pending account with database timestamps", async () => {
  const fixture = loadRegistration();
  await fixture.run();
  const profile = fixture.records.get("users/7caeb3fd-d955-49cb-a8d9-17f0e75d8620");
  profile.verificationExpiresAt = Timestamp.fromDate(new Date(Date.now() + 60000));
  await fixture.activate();
  assert.equal(fixture.response.statusCode, 200);
  const activated = fixture.records.get("users/7caeb3fd-d955-49cb-a8d9-17f0e75d8620");
  assert.equal(activated.emailVerified, true);
  assert.equal(activated.accountStatus, "active");
  assert.equal(activated.authUserId, activated.uid);
});

test("signup returns a verification-link instruction without exposing the token hash", async () => {
  const fixture = loadRegistration();
  await fixture.run();
  assert.equal(fixture.response.body.verificationMethod, "link");
  assert.equal(fixture.response.body.deliveryStatus, "sent");
  assert.match(fixture.response.body.message, /verification email/);
  assert.ok(!JSON.stringify(fixture.response.body).includes("012345"));
  assert.ok(!JSON.stringify(fixture.response.body).includes("opaque-token-hash"));
  await fixture.verifyCode();
  const profile = fixture.records.get("users/7caeb3fd-d955-49cb-a8d9-17f0e75d8620");
  assert.equal(profile.emailVerified, true);
  assert.equal(profile.verificationStatus, "verified");
  assert.equal(profile.accountStatus, "active");
});

test("a matching pending customer registration safely sends a new link without creating another identity", async () => {
  const fixture = loadRegistration({ existingPending: true, profile: {
    uid: "7caeb3fd-d955-49cb-a8d9-17f0e75d8620", profileDocId: "7caeb3fd-d955-49cb-a8d9-17f0e75d8620",
    authUserId: "7caeb3fd-d955-49cb-a8d9-17f0e75d8620", email: "customer@example.com", role: "customer",
    accountStatus: "inactive", verificationStatus: "pending", emailVerified: false,
    username: "survey_customer", phone: "+63 9940702702", verificationSentAt: new Date(Date.now() - 61000).toISOString(),
  } });
  await fixture.run();
  assert.equal(fixture.response.statusCode, 202);
  assert.equal(fixture.response.body.verificationMethod, "link");
  assert.equal(fixture.response.body.deliveryStatus, "sent");
  assert.equal(fixture.authCreated, 0);
  assert.equal(fixture.authDeleted, 0);
});

test("customer signup ignores a client-supplied staff role and stores customer in Auth metadata and profile", async () => {
  const fixture = loadRegistration({ payload: { role: "staff", user_metadata: { role: "admin" } } });
  await fixture.run();
  const profile = fixture.records.get("users/7caeb3fd-d955-49cb-a8d9-17f0e75d8620");
  assert.equal(fixture.signupMetadata.role, "customer");
  assert.equal(profile.role, "customer");
});

test("wrong codes and mismatched verification identities cannot activate the profile", async () => {
  for (const options of [{}, { verifiedEmail: "other@example.com" }]) {
    const fixture = loadRegistration(options);
    await fixture.run();
    await assert.rejects(fixture.verifyCode(options.verifiedEmail ? "012345" : "999999"), error => error.statusCode === 400);
    assert.equal(fixture.records.get("users/7caeb3fd-d955-49cb-a8d9-17f0e75d8620").emailVerified, false);
  }
});

test("provider outages remain service errors rather than false invalid-code errors", async () => {
  const failure = Object.assign(new Error("Provider unavailable"), { statusCode: 503 });
  const fixture = loadRegistration({ providerError: failure });
  await fixture.run();
  await assert.rejects(fixture.verifyCode(), error => error === failure);
});

test("expired or malformed database expiry timestamps cannot activate an account", async () => {
  for (const expiry of [Timestamp.fromDate(new Date(0)), undefined, "invalid"]) {
    const fixture = loadRegistration();
    await fixture.run();
    const profile = fixture.records.get("users/7caeb3fd-d955-49cb-a8d9-17f0e75d8620");
    profile.verificationExpiresAt = expiry;
    await assert.rejects(fixture.activate(), error => error.statusCode === 400);
    assert.equal(profile.accountStatus, "inactive");
  }
  const fixture = loadRegistration({ invalidToken: true });
  await fixture.run();
  await assert.rejects(fixture.activate(), error => error.statusCode === 400);
});

test("verification resend honors database Timestamp cooldown and sends a fresh link after it", async () => {
  const fixture = loadRegistration();
  await fixture.run();
  const profile = fixture.records.get("users/7caeb3fd-d955-49cb-a8d9-17f0e75d8620");
  profile.verificationSentAt = Timestamp.now();
  await assert.rejects(fixture.resend(), error => error.statusCode === 429);
  profile.verificationSentAt = Timestamp.fromDate(new Date(Date.now() - 61000));
  await fixture.resend();
  assert.equal(fixture.response.body.deliveryStatus, "sent");
  assert.equal(fixture.response.body.messageId, "mail-id");
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
