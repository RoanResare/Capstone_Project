const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { test } = require("node:test");
const jwt = require("jsonwebtoken");

const JWT_SECRET = "remember-device-test-secret";
const records = new Map();
let trustedLoginExpiresAt = 0;
let revokedLoginCount = 0;
const issuedLoginDevices = [];
const fakeDb = {
  collection() {
    const collection = {
      doc(id) {
        const reference = {
          id,
          async get() { const data = records.get(id); return { exists: Boolean(data), data: () => data }; },
          async set(data) { records.set(id, data); },
        };
        return reference;
      },
      where(field, operator, value) {
        return { async get() {
          const docs = [...records.entries()].filter(([, data]) => operator === "==" && data[field] === value)
            .map(([id, data]) => ({ id, ref: collection.doc(id), data: () => data }));
          return { docs };
        } };
      },
    };
    return collection;
  },
  async runTransaction(callback) {
    const tx = {
      async get(reference) { const data = records.get(reference.id); return { data: () => data }; },
      set(reference, data) { records.set(reference.id, data); },
    };
    return callback(tx);
  },
};

const trustedContext = {
  module: { exports: {} },
  require(name) {
    if (name === "node:crypto") return require("node:crypto");
    if (name === "../config/postgresDatabase") return { db: fakeDb };
    if (name === "../config/env") return { env: { nodeEnv: "production" } };
    throw new Error(`Unexpected trusted-device dependency: ${name}`);
  },
  Buffer,
  Date,
};
vm.runInNewContext(fs.readFileSync(path.join(__dirname, "../src/services/trustedDevice.service.js"), "utf8"), trustedContext);
const trustedDevices = trustedContext.module.exports;

const controllerContext = {
  module: { exports: {} },
  Buffer,
  Date,
  console,
  require(name) {
    if (name === "../services/authAttempts.service") return {
      assertAttemptsAllowed: async () => {}, recordFailedAttempt: async () => 4,
      resetAttempts: async () => {}, attemptReference: () => ({ get: async () => ({ data: () => ({}) }) }),
      lockError: () => new Error("locked"), MAX_FAILED_ATTEMPTS: 5,
    };
    if (name === "node:crypto") return require("node:crypto");
    if (name === "../config/clientOrigins") return { getAllowedClientOrigins: () => ["https://app.example.test"] };
    if (name === "../config/env") return { env: { nodeEnv: "test", otp: { ttlMinutes: 5 } } };
    if (name === "../constants/auth") return { USER_ROLES: { ADMIN: "admin", STAFF: "staff", CUSTOMER: "customer" }, USER_STATUSES: { ACTIVE: "active" }, FRAUD_STATUSES: {} };
    if (name === "../services/supabaseAuth.service") return {
      decodeJwtPayload: () => ({ session_id: "provider-session" }),
      createSupabaseSessionForUser: async (_email, id) => ({ access_token: "access", refresh_token: "refresh",
        user: { id, email: controllerContext.loginTestUser.email, email_confirmed_at: "verified" } }),
    };
    if (name === "../services/mail.service") return {};
    if (name === "../services/otp.service") return { verifyOtpCode: async () => {} };
    if (name === "../services/user.service") return { toPublicUser: value => value, touchLastLogin: async () => {},
      getUserByUid: async () => controllerContext.loginTestUser, getUserByAuthId: async () => controllerContext.loginTestUser };
    if (name === "../services/token.service") return {
      signAccessToken: (user, ip, sessionId) => jwt.sign({ sub: user.uid, connectionIp: ip, sessionId }, JWT_SECRET),
      signOtpTicket: () => "ticket", verifyOtpTicket: () => ({
        sub: controllerContext.loginTestUser.uid, role: controllerContext.otpRole || "staff", otpId: "otp-id",
      }),
    };
    if (name === "../utils/ApiError") return { ApiError: class ApiError extends Error { constructor(statusCode, message, details) { super(message); this.statusCode = statusCode; this.details = details; } } };
    if (name === "../services/sessionSecurity.service") return {
      createFreshSessionBinding: async (_user, req) => ({ ip: req.ip || "1.2.3.4", sessionId: `session-${req.ip || "default"}` }),
      validateAccessSecurity: async () => {}, waitForFreshSession: async (uid) => { controllerContext.recoveredUid = uid; },
    };
    if (name === "../utils/emailValidation") return {};
    if (name === "../utils/phoneNumber") return {};
    if (name === "../utils/password") return {};
    if (name === "../utils/setupGuard") return { assertAuthSetupReady() {} };
    if (name === "../services/registrationSecurity.service") return {};
    if (name === "../services/phoneAccounts.service") return {};
    if (name === "../services/trustedDevice.service") return {
      isTrustedDevice: async () => trustedLoginExpiresAt,
      issueTrustedDevice: async (_user, role) => {
        const expires = new Date(Date.now() + 14 * 86400000).toISOString();
        issuedLoginDevices.push(role);
        return expires;
      },
      revokeCurrentTrustedDevice: async () => { revokedLoginCount++; },
      revokeTrustedDevicesForUser: async () => 0,
    };
    throw new Error(`Unexpected auth-controller dependency: ${name}`);
  },
};
vm.runInNewContext(
  fs.readFileSync(path.join(__dirname, "../src/controllers/auth.controller.js"), "utf8") +
    "\nmodule.exports.testHelpers = { createSessionResponse, readRememberDeviceRequest, loginUnified, loginAdmin, loginStaff, verifyAdminOtp, verifyStaffOtp, portalDeviceLoginDecision, logout };",
  controllerContext,
);
const helpers = controllerContext.module.exports.testHelpers;
const user = { uid: "staff-id", authUserId: "auth-staff-id", role: "staff", email: "staff@example.test", accountStatus: "active", fullName: "Staff", passwordHash: "scrypt:test" };
vm.runInNewContext(`
  validateLoginPayload = (body) => body;
  verifyLoginCredentials = async () => ({ email: loginTestUser.email, signInPayload: { user: { id: loginTestUser.authUserId, email: loginTestUser.email, email_confirmed_at: "confirmed" } } });
  resolveAuthenticatedSupabaseUser = async () => loginTestUser;
  assertRoleMatchesExpected = () => {};
  assertActiveAccount = () => {};
  assertFraudAccess = () => {};
  synchronizePasswordHash = async () => {};
  createSessionResponse = async (_user, options) => ({ requiresTwoFactor: false, ...options });
  createOtpChallengeResponse = async () => ({ requiresTwoFactor: true });
  loginTestUser = ${JSON.stringify(user)};
`, controllerContext);

function responseCapture() {
  return { statusCode: 0, body: null, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; }, append() {} };
}

test("session issuance preserves fresh IP and session bindings for all three roles", async () => {
  for (const role of ["customer", "admin", "staff"]) {
    const profile = { ...user, uid: `${role}-id`, authUserId: `${role}-auth-id`, role };
    for (const ip of ["1.2.3.4", "5.6.7.8", "1.2.3.4"]) {
      const result = await helpers.createSessionResponse(profile, {}, { ip }, {
        access_token: "header.eyJzZXNzaW9uX2lkIjoic3VwYS1zZXNzaW9uIn0.signature",
        refresh_token: "refresh", user: { id: profile.authUserId, email: profile.email, email_confirmed_at: "confirmed" },
      });
      const payload = jwt.verify(result.accessToken, JWT_SECRET);
      assert.equal(controllerContext.recoveredUid, profile.uid);
      assert.equal(payload.sessionId, `session-${ip}`);
      assert.equal(payload.connectionIp, ip);
    }
  }
});

test("Admin and Staff require OTP until the matching password-authenticated trusted device is valid", async () => {
  for (const [role, handlers] of [["admin", [helpers.loginUnified, helpers.loginAdmin]], ["staff", [helpers.loginUnified, helpers.loginStaff]]]) {
    controllerContext.loginTestUser = { ...user, uid: `${role}-id`, authUserId: `${role}-id`, role };
    for (const handler of handlers) {
      trustedLoginExpiresAt = 0;
      const first = responseCapture();
      await handler({ body: { identifier: user.email, password: "valid-password", rememberDevice: true }, ip: "1.2.3.4" }, first);
      assert.equal(first.statusCode, 202);
      assert.equal(first.body.requiresTwoFactor, true);

      trustedLoginExpiresAt = Date.now() + 7 * 86400000;
      const later = responseCapture();
      await handler({ body: { identifier: user.email, password: "valid-password", rememberDevice: true }, ip: "1.2.3.4" }, later);
      assert.equal(later.statusCode, 200);
      assert.equal(later.body.trustedDeviceExpiresAt, new Date(trustedLoginExpiresAt).toISOString());

      const optedOut = responseCapture();
      await handler({ body: { identifier: user.email, password: "valid-password", rememberDevice: false }, ip: "1.2.3.4" }, optedOut);
      assert.equal(optedOut.statusCode, 202);
      assert.ok(revokedLoginCount >= 1);
    }
  }
  trustedLoginExpiresAt = 0;
});

test("trusted device cookie stores only a hash server-side and is HttpOnly, Secure, role-bound, expiring, and revocable", async () => {
  records.clear();
  const headers = [];
  const res = { append(name, value) { headers.push([name, value]); } };
  const profile = { uid: "admin-id", role: "admin", accountStatus: "active", passwordHash: "scrypt:admin" };
  const expiresAt = await trustedDevices.issueTrustedDevice(profile, "admin", res);
  const setCookie = headers[0][1];
  assert.match(setCookie, /__Host-furfection-trusted-admin=/);
  assert.match(setCookie, /HttpOnly/);
  assert.match(setCookie, /Secure/);
  assert.match(setCookie, /SameSite=None/);
  assert.match(setCookie, /Partitioned/);
  assert.match(setCookie, /Path=\//);
  const encoded = setCookie.match(/=([^;]+)/)[1];
  const credential = decodeURIComponent(encoded);
  const [deviceId, secret] = credential.split(".");
  assert.ok(deviceId && secret);
  const record = records.get(deviceId);
  assert.equal(record.userId, profile.uid);
  assert.equal(record.role, "admin");
  assert.notEqual(record.secretHash, secret);
  assert.equal(Date.parse(expiresAt) - record.createdAt, 14 * 86400000);
  const req = { headers: { cookie: `__Host-furfection-trusted-admin=${encoded}` } };
  assert.equal(await trustedDevices.isTrustedDevice(req, profile, "admin", res), Date.parse(expiresAt));
  for (const changes of [
    { accountStatus: "inactive" },
    { accountStatus: "suspended" },
    { fraudStatus: "suspended" },
    { fraudStatus: "banned" },
  ]) {
    assert.equal(await trustedDevices.isTrustedDevice(req, { ...profile, ...changes }, "admin", res), false);
  }
  assert.equal(await trustedDevices.isTrustedDevice(req, { ...profile, passwordHash: "scrypt:changed" }, "admin", res), false);
  assert.equal(records.get(deviceId).revokeReason, "password-changed");
  assert.equal(await trustedDevices.isTrustedDevice(req, { ...profile, uid: "other" }, "admin", res), false);
  assert.equal(await trustedDevices.isTrustedDevice(req, { ...profile, role: "staff" }, "staff", res), false);
  await trustedDevices.revokeCurrentTrustedDevice(req, res, "admin", profile.uid);
  assert.ok(records.get(deviceId).revokedAt > 0);
  assert.equal(await trustedDevices.isTrustedDevice(req, profile, "admin", res), false);
});

test("expired trusted-device credentials are revoked and the browser cookie is cleared", async () => {
  records.clear();
  const headers = [];
  const res = { append(name, value) { headers.push([name, value]); } };
  const profile = { uid: "staff-expired", role: "staff", accountStatus: "active", passwordHash: "scrypt:staff" };
  const expiresAt = await trustedDevices.issueTrustedDevice(profile, "staff", res);
  const setCookie = headers[0][1];
  const encoded = setCookie.match(/=([^;]+)/)[1];
  const deviceId = decodeURIComponent(encoded).split(".")[0];
  records.get(deviceId).expiresAt = Date.now() - 1;
  const req = { headers: { cookie: `__Host-furfection-trusted-staff=${encoded}` } };

  assert.equal(Date.parse(expiresAt) > Date.now(), true);
  assert.equal(await trustedDevices.isTrustedDevice(req, profile, "staff", res), false);
  assert.equal(records.get(deviceId).revokeReason, "expired");
  assert.ok(records.get(deviceId).revokedAt > 0);
  assert.match(headers.at(-1)[1], /Max-Age=0/);
});

test("logout ends the session without revoking a trusted device while Remember Me remains enabled", async () => {
  records.clear();
  const headers = [];
  const res = { append(name, value) { headers.push([name, value]); } };
  const profile = { uid: "staff-logout", role: "staff", accountStatus: "active", passwordHash: "scrypt:staff" };
  await trustedDevices.issueTrustedDevice(profile, "staff", res);
  const setCookie = headers[0][1];
  const encoded = setCookie.match(/=([^;]+)/)[1];
  const req = { headers: { cookie: `__Host-furfection-trusted-staff=${encoded}` },
    auth: { user: { uid: profile.uid, email: "staff@example.test" } } };

  const logoutResponse = responseCapture();
  await helpers.logout(req, logoutResponse);
  assert.equal(logoutResponse.statusCode, 200);
  assert.equal(await trustedDevices.isTrustedDevice(req, profile, "staff", res) > Date.now(), true);
});

test("customer cannot be issued an Admin or Staff trusted device", async () => {
  await assert.rejects(() => trustedDevices.issueTrustedDevice({ uid: "customer-id", role: "customer" }, "admin", { append() {} }));
});

test("account security events revoke all of that account's trusted devices individually", async () => {
  records.clear();
  await trustedDevices.issueTrustedDevice({ uid: "staff-owner", role: "staff", passwordHash: "hash-a" }, "staff", { append() {} });
  await trustedDevices.issueTrustedDevice({ uid: "staff-owner", role: "staff", passwordHash: "hash-a" }, "staff", { append() {} });
  await trustedDevices.issueTrustedDevice({ uid: "other-staff", role: "staff", passwordHash: "hash-b" }, "staff", { append() {} });
  assert.equal(await trustedDevices.revokeTrustedDevicesForUser("staff-owner", "password-reset"), 2);
  const ownerRecords = [...records.values()].filter((record) => record.userId === "staff-owner");
  const otherRecord = [...records.values()].find((record) => record.userId === "other-staff");
  assert.equal(ownerRecords.every((record) => record.revokedAt > 0 && record.revokeReason === "password-reset"), true);
  assert.equal(otherRecord.revokedAt, 0);
});

test("successful initial Admin and Staff OTP registers trust only when Remember Me is enabled", async () => {
  for (const role of ["admin", "staff"]) {
    const handler = role === "admin" ? helpers.verifyAdminOtp : helpers.verifyStaffOtp;
    controllerContext.loginTestUser = { ...user, uid: `${role}-id`, authUserId: `${role}-id`, role };
    controllerContext.otpRole = role;
    const before = issuedLoginDevices.length;
    const remembered = responseCapture();
    await handler({ body: { otpTicket: "valid-ticket", otpCode: "123456", rememberDevice: true } }, remembered);
    assert.equal(remembered.statusCode, 200);
    assert.equal(remembered.body.rememberDevice, true);
    assert.equal(issuedLoginDevices.at(-1), role);
    assert.equal(issuedLoginDevices.length, before + 1);

    const optedOut = responseCapture();
    await handler({ body: { otpTicket: "valid-ticket", otpCode: "123456", rememberDevice: false } }, optedOut);
    assert.equal(optedOut.statusCode, 200);
    assert.equal(optedOut.body.trustedDeviceExpiresAt, "");
  }
});
