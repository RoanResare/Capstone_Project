const { test } = require("node:test");
const assert = require("node:assert/strict");
const { env } = require("../src/config/env");
const nodemailer = require("nodemailer");
const mailer = require("../src/config/mailer");

test("auto mode selects SMTP; explicit Gmail API and disabled modes are respected", () => {
  const { resolveMailDeliveryMode } = require("../src/config/env");
  const originalMode = env.mail.deliveryMode;
  const originalPass = env.mail.smtp.pass;
  const originalRuntime = { ...env.runtime };
  try {
    env.mail.deliveryMode = "auto";
    env.mail.smtp.pass = "test-app-password";
    env.runtime.smtpReady = true;
    env.runtime.gmailApiReady = true;
    assert.equal(resolveMailDeliveryMode(), "smtp");
    env.runtime.gmailApiReady = false;
    assert.equal(resolveMailDeliveryMode(), "smtp");
    env.mail.deliveryMode = "gmail-api";
    env.runtime.gmailApiReady = true;
    assert.equal(resolveMailDeliveryMode(), "gmail-api");
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
    env.runtime.mailDeliveryReady = false;
    await assert.rejects(sendAppointmentReminder({ customerEmail: "customer@example.com" }, "booking-2"), /not configured/);
  } finally {
    nodemailer.createTransport = originalCreate;
    Object.assign(env.runtime, originalRuntime);
  }
});


test("Gmail API sends reminders through HTTPS with a stable message ID", async () => {
  const originalRuntime = { ...env.runtime };
  const originalFetch = global.fetch;
  const requests = [];
  try {
    env.runtime.mailDeliveryMode = "gmail-api";
    env.runtime.mailDeliveryReady = true;
    env.runtime.gmailApiReady = true;
    global.fetch = async (url, options) => {
      requests.push({ url, options });
      return { ok: true, json: async () => url.includes("oauth2.googleapis.com")
        ? { access_token: "mock-token", expires_in: 3600 } : { id: "api-message" } };
    };
    const { sendAppointmentReminder } = require("../src/services/reminderMail.service");
    const result = await sendAppointmentReminder({ customerEmail: "customer@example.com", scheduleDate: "2026-10-21", scheduleTime: "11:00" }, "api-booking");
    assert.equal(result.messageId, "api-message");
    const sent = requests.find(request => request.url.includes("messages/send"));
    assert.ok(sent);
    const raw = Buffer.from(JSON.parse(sent.options.body).raw, "base64url").toString();
    assert.match(raw, /Message-ID: <reminder-/);
    assert.match(raw, /To: customer@example.com/);
  } finally {
    global.fetch = originalFetch;
    Object.assign(env.runtime, originalRuntime);
  }
});
