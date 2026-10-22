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
  const user = { uid: "test-user", email: "customer@example.com", role: "admin", accountStatus: "active" };
  const context = { module: { exports: {} }, console: { info() {}, warn() {}, error() {} }, URL,
    require(id) {
      if (id === "../config/firebaseAdmin") return { auth: { getUserByEmail: async () => user } };
      if (id === "../utils/setupGuard") return { assertAuthSetupReady() {} };
      if (id === "../services/registrationSecurity.service") return { assertEmailIsDeliverable: async () => {} };
      if (id === "../services/mail.service") return { sendOtpEmail: send, sendPasswordResetEmail: send };
      if (id === "../services/otp.service") return { createOtpVerification: async () => ({
        otpId: "otp-1", otpCode: "012345", expiresAt: new Date(), resendAvailableAt: new Date(),
      }) };
      if (id === "../services/user.service") return {
        findUserByEmailCaseInsensitive: async () => user, getUserByUid: async () => user, toPublicUser: () => user,
      };
      if (id === "../services/token.service") return { signOtpTicket: () => "signed-ticket" };
      if (id === "../services/firebaseAuth.service") return {
        generatePasswordResetLink: async () => "https://example.com/reset?oobCode=test-code",
      };
      return localRequire(id);
    },
  };
  vm.runInNewContext(fs.readFileSync(filename, "utf8") + "\nmodule.exports.challenge = createOtpChallengeResponse;", context, { filename });
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
