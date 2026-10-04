const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { test } = require("node:test");
const jwt = require("jsonwebtoken");

const secret = "remember-device-test-secret";
const tokenContext = {
  module: { exports: {} },
  require(name) {
    if (name === "jsonwebtoken") return jwt;
    if (name === "../config/env") return { env: { auth: { jwtSecret: secret, jwtExpiresIn: "14d" } } };
    return {};
  },
};
vm.runInNewContext(fs.readFileSync(path.join(__dirname, "../src/services/token.service.js"), "utf8"), tokenContext);
const tokens = tokenContext.module.exports;
const controllerContext = {
  module: { exports: {} },
  require(name) {
    if (name === "../services/token.service") return tokens;
    if (name === "../constants/auth") return { USER_ROLES: { ADMIN: "admin", STAFF: "staff", CUSTOMER: "customer" } };
    if (name === "../utils/setupGuard") return { assertAuthSetupReady() {} };
    if (name === "../services/registrationSecurity.service") return { validateAccessSecurity: async () => {}, getClientIp: (req) => req.ip };
    if (name === "../services/sessionSecurity.service") return { createFreshSessionBinding: async (uid, ip) => {
      controllerContext.binding = { uid, ip, sessionId: require("node:crypto").randomUUID() };
      return controllerContext.binding.sessionId;
    } };
    if (name === "../config/firebaseAdmin") return { auth: { createCustomToken: async (uid, claims) => {
      controllerContext.firebaseClaims = { uid, ...claims };
      return "firebase-custom-token";
    } } };
    if (name === "../services/user.service") return { getUserByEmail: async () => null,
      toPublicUser: (user) => user, touchLastLogin: async () => {} };
    if (name === "../services/firebaseAuth.service") return {
      signInWithEmailAndPassword: async () => ({ localId: controllerContext.loginTestUser.uid }),
    };
    return {};
  },
};
vm.runInNewContext(
  fs.readFileSync(path.join(__dirname, "../src/controllers/auth.controller.js"), "utf8") +
    "\nmodule.exports.rememberHelpers = { readRememberDeviceRequest, isRememberedPortalDevice, createSessionResponse };",
  controllerContext,
);
const { readRememberDeviceRequest, isRememberedPortalDevice } = controllerContext.module.exports.rememberHelpers;

test("verified login issues matching unique binding claims in access and Firebase tokens for every role", async () => {
  const sessionIds = new Set();
  for (const role of ["customer", "admin", "staff"]) {
    const user = { uid: `${role}-id`, role, accountStatus: "active" };
    for (const ip of ["1.2.3.4", "5.6.7.8", "1.2.3.4"]) {
      const result = await controllerContext.module.exports.rememberHelpers.createSessionResponse(user, {}, { ip });
      const payload = jwt.verify(result.accessToken, secret);
      assert.equal(payload.sessionId, controllerContext.binding.sessionId);
      assert.equal(controllerContext.firebaseClaims.sessionId, payload.sessionId);
      assert.equal(controllerContext.binding.uid, user.uid);
      assert.equal(controllerContext.binding.ip, ip);
      assert.equal(payload.connectionIp, ip);
      assert.equal(controllerContext.firebaseClaims.connectionIp, ip);
      assert.equal(sessionIds.has(payload.sessionId), false);
      sessionIds.add(payload.sessionId);
    }
  }
  assert.equal(sessionIds.size, 9);
});

test("unchecked login requires OTP even with a valid saved device token", async () => {
  controllerContext.loginTestUser = { uid: "staff-id", email: "staff@example.test", role: "staff" };
  vm.runInNewContext(`
    validateLoginPayload = (body) => body;
    resolveEmailFromIdentifier = async () => loginTestUser.email;
    resolveAuthenticatedFirestoreUser = async () => loginTestUser;
    synchronizePasswordHash = async () => {};
    assertActiveAccount = () => {};
    assertFraudAccess = () => {};
    assertRoleMatchesExpected = () => {};
    createSessionResponse = async (user, options) => ({ requiresTwoFactor: false, ...options });
    createOtpChallengeResponse = async () => ({ requiresTwoFactor: true });
  `, controllerContext);
  const token = tokens.signRememberDeviceToken(controllerContext.loginTestUser);
  for (const handler of [controllerContext.module.exports.loginUnified, controllerContext.module.exports.loginStaff]) {
    for (const rememberDevice of [false, true]) {
      let result;
      const res = { status() { return this; }, json(value) { result = value; } };
      await handler({ body: {
        identifier: "staff@example.test", password: "test-password", rememberDevice,
        rememberDeviceToken: token,
      } }, res);
      assert.equal(result.requiresTwoFactor, !rememberDevice);
      if (rememberDevice) assert.equal(result.rememberDeviceToken, token);
    }
  }
});

test("trusted devices last 14 days and require the correct account and role", () => {
  const admin = { uid: "admin-id", email: "admin@example.test", role: "admin" };
  const staff = { uid: "staff-id", email: "staff@example.test", role: "staff" };
  const adminToken = tokens.signRememberDeviceToken(admin);
  const staffToken = tokens.signRememberDeviceToken(staff);
  const payload = jwt.decode(adminToken);
  assert.equal(payload.exp - payload.iat, 14 * 24 * 60 * 60);
  const req = { body: { rememberDevice: true, rememberDeviceTokens: { admin: adminToken, staff: staffToken } } };
  assert.equal(readRememberDeviceRequest(req, "staff").rememberDeviceToken, staffToken);
  assert.equal(readRememberDeviceRequest(req, "admin").rememberDeviceToken, adminToken);
  assert.equal(isRememberedPortalDevice(staff, staffToken), true);
  assert.equal(isRememberedPortalDevice(staff, adminToken), false);
  assert.equal(isRememberedPortalDevice({ ...staff, uid: "another-staff" }, staffToken), false);
  assert.equal(isRememberedPortalDevice(admin, ""), false);
  assert.equal(isRememberedPortalDevice({ ...admin, role: "customer" }, adminToken), false);
  const expiredToken = jwt.sign({ ...payload, exp: Math.floor(Date.now() / 1000) - 1 }, secret);
  assert.equal(isRememberedPortalDevice(admin, expiredToken), false);
});
