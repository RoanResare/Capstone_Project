const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const { createRequire } = require("node:module");
const path = require("node:path");
const { ApiError } = require("../src/utils/ApiError");

function loadController(send) {
  const filename = path.resolve(__dirname, "../src/controllers/auth.controller.js");
  const localRequire = createRequire(filename);
  const user = { uid: "test-user", authUserId: "auth-test-user", email: "customer@example.com", role: "admin", accountStatus: "active" };
  const supabaseUser = { id: user.authUserId, email: user.email, user_metadata: { full_name: "Customer" } };
  const context = { module: { exports: {} }, Buffer, console: { info() {}, warn() {}, error() {} }, URL,
    require(id) {
      if (id === "../services/authAttempts.service") return { MAX_FAILED_ATTEMPTS: 5 };
      if (id === "../services/phoneAccounts.service") return {};
      if (id === "../services/sessionSecurity.service") return { validateAccessSecurity: async () => {}, waitForFreshSession: async () => {}, createFreshSessionBinding: async () => ({ ip: "127.0.0.1", sessionId: "test-session" }) };
      if (id === "../config/env") return { env: { nodeEnv: "test", otp: { ttlMinutes: 5 },
        passwordReset: { ttlMinutes: 30 }, auth: { jwtSecret: "test-secret", passwordResetUrl: "https://example.test/reset-password" } } };
      if (id === "../config/clientOrigins") return { getAllowedClientOrigins: () => [
        "https://capstone-project-1-yqto.onrender.com", "https://www.charmingfurfectionpetscareservices.online",
      ] };
      if (id === "../utils/setupGuard") return { assertAuthSetupReady() {} };
      if (id === "../services/registrationSecurity.service") return { assertEmailIsDeliverable: async () => {} };
      if (id === "../services/mail.service") return { sendOtpEmail: send, sendPasswordResetEmail: send };
      if (id === "../services/otp.service") return { createOtpVerification: async () => ({
        otpId: "otp-1", otpCode: "012345", expiresAt: new Date(), resendAvailableAt: new Date(),
      }) };
      if (id === "../services/user.service") return {
        findUserByEmailCaseInsensitive: async () => user, getUserByUid: async () => user,
        getUserByEmail: async () => user, toPublicUser: () => user,
      };
      if (id === "../services/token.service") return { signOtpTicket: () => "signed-ticket" };
      if (id === "../services/supabaseAuth.service") return {
        findSupabaseUserByEmail: async () => supabaseUser,
        generateSupabaseRecoveryToken: async () => ({ tokenHash: "test-recovery-token-hash" }),
      };
      if (id === "../services/trustedDevice.service") return { revokeTrustedDevicesForUser: async () => 0 };
      return localRequire(id);
    },
  };
  vm.runInNewContext(fs.readFileSync(filename, "utf8") + "\nmodule.exports.challenge = createOtpChallengeResponse; module.exports.resetLink = buildPasswordResetUrl;", context, { filename });
  return { controller: context.module.exports, user };
}

test("OTP challenge is returned only after successful email transmission", async () => {
  const failure = new ApiError(503, "Resend rejected the email", { code: "MAIL_DELIVERY_FAILED" });
  const failed = loadController(async () => { throw failure; });
  await assert.rejects(failed.controller.challenge(failed.user, "sent"), error => error === failure);
  let payload;
  const success = loadController(async value => { payload = value; return { deliveryMode: "resend" }; });
  const result = await success.controller.challenge(success.user, "sent");
  assert.equal(payload.otpCode, "012345");
  assert.equal(payload.to, success.user.email);
  assert.equal(result.otpTicket, "signed-ticket");
  assert.equal(result.requiresTwoFactor, true);
});

test("password reset surfaces mail failures instead of claiming a link was sent", async () => {
  const failure = new ApiError(503, "Resend rejected the email");
  const { controller } = loadController(async () => { throw failure; });
  const req = { body: { identifier: "customer@example.com" }, headers: { origin: "http://localhost:5173" } };
  await assert.rejects(controller.forgotPassword(req, { status() { assert.fail("Must not return success"); } }), error => error === failure);
});

test("password reset links use an allowlisted frontend and seal the Supabase recovery token", async () => {
  for (const origin of ["https://capstone-project-1-yqto.onrender.com",
    "https://www.charmingfurfectionpetscareservices.online"]) {
    let mail;
    const { controller } = loadController(async value => { mail = value; return { deliveryMode: "resend" }; });
    controller.resetDependencies = true;
    const res = { status() { return this; }, json(value) { this.body = value; return this; } };
    await controller.forgotPassword({ body: { identifier: "customer@example.com" }, headers: { origin } }, res);
    const link = new URL(mail.resetLink);
    assert.equal(link.origin, origin);
    assert.equal(link.pathname, "/reset-password");
    const challenge = link.searchParams.get("oobCode");
    assert.ok(challenge);
    const [payload] = challenge.split(".");
    const record = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    assert.equal(record.type, "recovery");
    assert.equal(record.email, "customer@example.com");
    assert.equal(record.tokenHash, "test-recovery-token-hash");
  }
});
