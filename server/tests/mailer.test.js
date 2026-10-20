const { test } = require("node:test");
const assert = require("node:assert/strict");
const { env } = require("../src/config/env");
const nodemailer = require("nodemailer");
const mailer = require("../src/config/mailer");

test("app passwords select SMTP over the legacy Gmail API setting; disabled stays disabled", () => {
  const { resolveMailDeliveryMode } = require("../src/config/env");
  const originalMode = env.mail.deliveryMode;
  const originalPass = env.mail.smtp.pass;
  const originalRuntime = { ...env.runtime };
  try {
    env.mail.deliveryMode = "gmail-api";
    env.mail.smtp.pass = "test-app-password";
    env.runtime.smtpReady = true;
    env.runtime.gmailApiReady = true;
    assert.equal(resolveMailDeliveryMode(), "smtp");
    env.runtime.gmailApiReady = false;
    assert.equal(resolveMailDeliveryMode(), "smtp");
    env.mail.deliveryMode = "disabled";
    assert.equal(resolveMailDeliveryMode(), "disabled");
    env.mail.deliveryMode = "gmail-api";
    env.mail.smtp.pass = "";
    env.runtime.gmailApiReady = true;
    assert.equal(resolveMailDeliveryMode(), "gmail-api");
  } finally {
    env.mail.deliveryMode = originalMode;
    env.mail.smtp.pass = originalPass;
    Object.assign(env.runtime, originalRuntime);
  }
});

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
