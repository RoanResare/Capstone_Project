const { test } = require("node:test");
const assert = require("node:assert/strict");
const { env } = require("../src/config/env");
const nodemailer = require("nodemailer");
const mailer = require("../src/config/mailer");

test("legacy modes cannot select Gmail API; missing SMTP credentials fail closed", () => {
  const { resolveMailDeliveryMode } = require("../src/config/env");
  const originalMode = env.mail.deliveryMode;
  const originalRuntime = { ...env.runtime };
  try {
    env.runtime.smtpReady = true;
    for (const mode of ["smtp", "auto", "gmail-api"]) {
      env.mail.deliveryMode = mode;
      assert.equal(resolveMailDeliveryMode(), "smtp");
    }
    env.runtime.smtpReady = false;
    assert.equal(resolveMailDeliveryMode(), "disabled");
    env.runtime.smtpReady = true;
    env.mail.deliveryMode = "disabled";
    assert.equal(resolveMailDeliveryMode(), "disabled");
  } finally {
    env.mail.deliveryMode = originalMode;
    Object.assign(env.runtime, originalRuntime);
  }
});

test("SMTP verification and OTP delivery use the configured app password without OAuth", async () => {
  const originalCreate = nodemailer.createTransport;
  const originalRuntime = { ...env.runtime };
  const originalFetch = global.fetch;
  let transportCount = 0;
  let deliveryError;
  let message;
  try {
    env.runtime.mailDeliveryMode = "smtp";
    env.runtime.mailDeliveryReady = true;
    global.fetch = async () => { throw new Error("Email must never request an OAuth token or API endpoint"); };
    nodemailer.createTransport = (options) => {
      transportCount++;
      assert.equal(options.auth.type, undefined);
      assert.equal(options.auth.pass, env.mail.smtp.pass);
      assert.equal(options.auth.user, env.mail.smtp.user);
      return {
        verify: async () => true,
        sendMail: async (value) => {
          if (deliveryError) throw deliveryError;
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
    assert.equal(message.from.address, env.mail.fromEmail);
    const { sendPasswordResetEmail, sendEmailVerificationLink } = require("../src/services/mail.service");
    await sendPasswordResetEmail({ to: "customer@example.com", resetLink: "https://example.com/reset?code=reset" });
    assert.match(message.text, /code=reset/);
    await sendEmailVerificationLink({ to: "customer@example.com", verificationLink: "https://example.com/activate?code=activation" });
    assert.match(message.text, /code=activation/);
    const { sendAppointmentReminder } = require("../src/services/reminderMail.service");
    const reminder = await sendAppointmentReminder({ customerEmail: "customer@example.com", scheduleDate: "2026-10-21", scheduleTime: "09:00" }, "booking-1");
    assert.equal(reminder.messageId, "test-message");
    assert.match(message.text, /09:00 AM/);
    assert.match(message.messageId, /^<reminder-/);
    assert.equal(transportCount, 1);
    for (const code of ["EAUTH", "ETIMEDOUT", "EENVELOPE"]) {
      deliveryError = Object.assign(new Error("test failure"), { code });
      await assert.rejects(sendOtpEmail({ to: "customer@example.com", otpCode: "123456" }), error => {
        assert.equal(error.statusCode, 503);
        assert.doesNotMatch(error.message, /OAuth|Gmail API/);
        assert.match(error.message, /SMTP|email server/);
        return true;
      });
    }
    env.runtime.mailDeliveryReady = false;
    await assert.rejects(mailer.sendMail({ to: "customer@example.com" }), /EMAIL_USER and EMAIL_PASS/);
    await assert.rejects(mailer.verifyMailerConnection(), /EMAIL_USER and EMAIL_PASS/);
    await assert.rejects(sendAppointmentReminder({ customerEmail: "customer@example.com" }, "booking-2"), /not configured/);
  } finally {
    global.fetch = originalFetch;
    nodemailer.createTransport = originalCreate;
    Object.assign(env.runtime, originalRuntime);
  }
});



test("environment credentials come only from EMAIL_USER and EMAIL_PASS", () => {
  const fs = require("node:fs");
  const vm = require("node:vm");
  const path = require("node:path");
  function load(values) {
    const sandbox = {
      process: { env: values },
      module: { exports: {} },
      require(id) {
        if (id === "fs") return { existsSync: () => false };
        if (id === "path") return path;
        if (id === "./loadEnv") return { loadEnvFiles: () => ({ projectRoot: __dirname, serverRoot: __dirname, files: [] }) };
        throw new Error(id);
      },
    };
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, "../src/config/env.js"), "utf8"), sandbox);
    return sandbox.module.exports;
  }
  const legacy = { MAIL_DELIVERY_MODE: "gmail-api", SMTP_USER: "wrong@example.com", SMTP_PASS: "wrong", GMAIL_USER: "wrong@gmail.com", GMAIL_APP_PASSWORD: "wrong", GMAIL_CLIENT_ID: "old", GMAIL_CLIENT_SECRET: "old", GMAIL_REFRESH_TOKEN: "old" };
  const configured = load({ ...legacy, EMAIL_USER: "sender@gmail.com", EMAIL_PASS: "abcd efgh ijkl mnop" });
  assert.equal(configured.env.runtime.mailDeliveryMode, "smtp");
  assert.equal(configured.env.mail.smtp.user, "sender@gmail.com");
  assert.equal(configured.env.mail.smtp.pass, "abcdefghijklmnop");
  assert.equal(configured.env.mail.fromEmail, "sender@gmail.com");
  assert.equal(configured.env.mail.oauth, undefined);
  assert.equal(load(legacy).env.runtime.mailDeliveryReady, false);
  const failures = load(legacy).getStartupDiagnostics().failedChecks;
  assert.deepEqual(Array.from(failures.find(check => check.label === "Mail Delivery").required), ["EMAIL_USER", "EMAIL_PASS"]);
  assert.equal(load({ EMAIL_USER: "sender@example.com", EMAIL_PASS: "pass with spaces", SMTP_HOST: "smtp.example.com" }).env.mail.smtp.pass, "pass with spaces");
});
