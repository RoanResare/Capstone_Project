const { test } = require("node:test");
const assert = require("node:assert/strict");
const { env } = require("../src/config/env");
const nodemailer = require("nodemailer");
const mailer = require("../src/config/mailer");

test("SMTP verification and OTP delivery use the configured app password without OAuth", async () => {
  const originalCreate = nodemailer.createTransport;
  const originalRuntime = { ...env.runtime };
  let message;
  try {
    env.runtime.mailDeliveryMode = "smtp";
    env.runtime.mailDeliveryReady = true;
    env.runtime.gmailApiReady = false;
    nodemailer.createTransport = (options) => {
      assert.equal(options.auth.pass, env.mail.smtp.pass);
      assert.equal(options.auth.user, env.mail.smtp.user);
      return {
        verify: async () => true,
        sendMail: async (value) => {
          message = value;
          return { accepted: [value.to], messageId: "test-message" };
        },
      };
    };
    assert.equal(await mailer.verifyMailerConnection(), true);
    const { sendOtpEmail } = require("../src/services/mail.service");
    const result = await sendOtpEmail({ to: "customer@example.com", otpCode: "123456", role: "customer", expiresInMinutes: 5 });
    assert.equal(result.deliveryMode, "smtp");
    assert.equal(result.messageId, "test-message");
    assert.match(message.text, /123456/);
    assert.equal(message.to, "customer@example.com");
  } finally {
    nodemailer.createTransport = originalCreate;
    Object.assign(env.runtime, originalRuntime);
  }
});
