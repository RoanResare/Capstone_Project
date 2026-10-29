const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const { ApiError } = require("../src/utils/ApiError");

function fixture(options = {}) {
  const user = options.missingProfile ? null : { uid: "auth-id", authUserId: "auth-id", email: "user@gmail.com",
    role: "customer", accountStatus: "active", fraudStatus: "normal", emailVerified: true, ...options.profile };
  const session = { access_token: "provider-token", refresh_token: "provider-refresh", user: {
    id: "auth-id", email: "user@gmail.com", email_confirmed_at: "2026-01-01T00:00:00Z",
    user_metadata: { role: "admin" }, ...options.identity,
  } };
  const calls = { passwords: 0, sessions: 0, failed: 0, otp: 0, links: 0 };
  const dependencies = {
    "../config/env": { env: { otp: { ttlMinutes: 5 } } },
    "../utils/setupGuard": { assertAuthSetupReady() {} },
    "../services/authAttempts.service": { assertAttemptsAllowed: async () => {}, resetAttempts: async () => {},
      recordFailedAttempt: async () => { calls.failed++; return 4; } },
    "../services/supabaseAuth.service": { decodeJwtPayload: () => ({}),
      signInWithSupabasePassword: async (email, password) => {
        calls.passwords++; assert.equal(email, "user@gmail.com"); assert.equal(password, "ExactPass! ");
        if (options.authError) throw options.authError;
        return session;
      }, createSupabaseSessionForUser: async (_email, id) => { assert.equal(id, "auth-id"); return session; } },
    "../services/user.service": {
      getUserByAuthId: async () => user, getUserByUid: async () => user, findUserByEmailCaseInsensitive: async () => user,
      getUsernameOwner: async () => ({ email: "user@gmail.com" }), getUserByUsername: async () => user,
      toPublicUser: value => value, touchLastLogin: async () => {}, updateStoredPasswordHash: async () => {},
      linkSupabaseAuthUser: async (value, id) => { calls.links++; return { ...value, authUserId: id }; },
    },
    "../services/sessionSecurity.service": { validateAccessSecurity: async () => {}, waitForFreshSession: async () => {},
      createFreshSessionBinding: async () => ({ ip: "127.0.0.1", sessionId: "binding" }) },
    "../services/token.service": { signAccessToken: () => { calls.sessions++; return "server-token"; },
      signOtpTicket: () => "otp-ticket", verifyOtpTicket: () => ({ sub: "auth-id", role: options.profile?.role, otpId: "challenge" }) },
    "../services/otp.service": { createOtpVerification: async () => {
      calls.otp++; return { otpId: "challenge", otpCode: "123456", expiresAt: new Date(), resendAvailableAt: new Date() };
    }, verifyOtpCode: async () => { if (options.invalidOtp) throw new ApiError(401, "Invalid OTP"); } },
    "../services/mail.service": { sendOtpEmail: async () => ({ deliveryMode: "resend" }) },
    "../utils/password": { verifyPasswordHash: () => true },
    "../services/registrationSecurity.service": { assertEmailIsDeliverable: async () => assert.fail("Login must not run signup DNS checks") },
    "../config/clientOrigins": {}, "../services/phoneAccounts.service": {},
  };
  const filename = path.resolve(__dirname, "../src/controllers/auth.controller.js");
  const controller = new Module(filename, module);
  controller.filename = filename; controller.paths = module.paths;
  const realRequire = controller.require.bind(controller);
  controller.require = id => id in dependencies ? dependencies[id] : realRequire(id);
  controller._compile(fs.readFileSync(filename, "utf8"), filename);
  const response = { status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } };
  return { calls, response, user, run: (handler = "loginUnified", identifier = "user@gmail.com") => controller.exports[handler](
    { body: { identifier, password: "ExactPass! ", role: "admin", otpTicket: "otp-ticket", otpCode: "123456" }, headers: {}, ip: "127.0.0.1" }, response) };
}

test("email and username login use Auth credentials and the PostgreSQL customer role, ignoring requested/metadata roles", async () => {
  for (const identifier of [" USER@gmail.com ", "customer_name"]) {
    const f = fixture(); await f.run("loginUnified", identifier);
    assert.equal(f.response.code, 200);
    assert.equal(f.response.body.user.role, "customer");
    assert.equal(f.response.body.homePath, "/customer/dashboard");
    assert.equal(f.calls.passwords, 1); assert.equal(f.calls.sessions, 1);
  }
});

test("staff and admin login require OTP and return no access or Supabase session tokens", async () => {
  for (const role of ["staff", "admin"]) {
    const f = fixture({ profile: { role } }); await f.run();
    assert.equal(f.response.code, 202);
    assert.equal(f.response.body.requiresTwoFactor, true);
    assert.equal(f.response.body.user.role, role);
    assert.equal(f.response.body.accessToken, undefined);
    assert.equal(f.response.body.supabaseSession, undefined);
    assert.equal(f.calls.otp, 1); assert.equal(f.calls.sessions, 0);
  }
});

test("unverified, inactive, banned, missing, mismatched, or unsupported profiles never receive sessions", async () => {
  for (const options of [
    { identity: { email_confirmed_at: null, confirmed_at: "2026-01-01" } },
    { identity: { email: "other@gmail.com" } }, { profile: { email: "other@gmail.com" } },
    { profile: { authUserId: "different-auth-id" } }, { profile: { accountStatus: "inactive" } },
    { profile: { verificationStatus: "pending" } }, { profile: { emailVerified: false } },
    { profile: { fraudStatus: "banned" } }, { profile: { role: "superadmin" } }, { missingProfile: true },
    { profile: { uid: "legacy-admin", authUserId: "", role: "admin" } },
  ]) {
    const f = fixture(options);
    await assert.rejects(f.run(), error => error.statusCode === 403);
    assert.equal(f.calls.sessions, 0); assert.equal(f.calls.otp, 0); assert.equal(f.calls.links, 0);
  }
});

test("invalid passwords increment failed attempts and cannot use the PostgreSQL password hash as fallback", async () => {
  const f = fixture({ authError: new ApiError(401, "Invalid credentials", { supabaseCode: "INVALID_LOGIN_CREDENTIALS" }) });
  await assert.rejects(f.run(), error => error.statusCode === 401);
  assert.equal(f.calls.failed, 1); assert.equal(f.calls.sessions, 0);
});

test("a role-specific portal cannot accept a different PostgreSQL role", async () => {
  const f = fixture();
  await assert.rejects(f.run("loginAdmin"), error => error.statusCode === 403);
  assert.equal(f.calls.sessions, 0); assert.equal(f.calls.otp, 0);
});

test("staff and admin sessions route to their own dashboard only after OTP verification", async () => {
  for (const role of ["staff", "admin"]) {
    const f = fixture({ profile: { role } });
    await f.run(); assert.equal(f.calls.sessions, 0);
    await f.run(role === "staff" ? "verifyStaffOtp" : "verifyAdminOtp");
    assert.equal(f.response.code, 200);
    assert.equal(f.response.body.homePath, `/${role}/dashboard`);
    assert.equal(f.calls.sessions, 1);
    const invalid = fixture({ profile: { role }, invalidOtp: true });
    await assert.rejects(invalid.run(role === "staff" ? "verifyStaffOtp" : "verifyAdminOtp"), error => error.statusCode === 401);
    assert.equal(invalid.calls.sessions, 0);
  }
});

test("unknown PostgreSQL roles/statuses fail closed and native UUID lookup cannot override a conflicting Auth link", async () => {
  const filename = path.resolve(__dirname, "../src/services/user.service.js");
  const service = new Module(filename, module);
  service.filename = filename; service.paths = module.paths;
  const realRequire = service.require.bind(service);
  service.require = id => {
    if (id === "../config/postgresDatabase") return { db: { collection: () => ({
      where: () => ({ limit: () => ({ get: async () => ({ empty: true }) }) }),
      doc: () => ({ get: async () => ({ exists: true, id: "auth-id", data: () => ({
        uid: "auth-id", authUserId: "different-auth-id", email: "user@gmail.com", role: "customer", accountStatus: "active",
      }) }) }),
    }) } };
    if (["./supabaseAuth.service", "./registrationSecurity.service"].includes(id)) return {};
    return realRequire(id);
  };
  service._compile(fs.readFileSync(filename, "utf8"), filename);
  const profile = service.exports.toPublicUser({ uid: "id", role: "superadmin", accountStatus: "unknown" });
  assert.equal(profile.role, ""); assert.equal(profile.accountStatus, "inactive");
  assert.equal(await service.exports.getUserByAuthId("auth-id"), null);
});
