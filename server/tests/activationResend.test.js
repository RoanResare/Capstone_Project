const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");

function fixture(options = {}) {
  let sent = 0;
  let generated = 0;
  let payload;
  const filename = path.resolve(__dirname, "../src/controllers/registration.controller.js");
  const controller = new Module(filename, module);
  controller.filename = filename;
  controller.paths = module.paths;
  const realRequire = controller.require.bind(controller);
  controller.require = id => {
    if (id === "../config/env") return { env: { runtime: { mailDeliveryReady: !options.noMail, supabaseAdminReady: !options.noSupabase }, auth: {
      emailVerificationUrl: "https://capstone-project-1-yqto.onrender.com/activate-account",
    } } };
    if (id === "../config/postgresDatabase") return { db: { collection: name => ({ doc: uid => {
      assert.equal(name, "users"); assert.equal(uid, "uid-1");
      return { async update() { if (options.metadataError) throw options.metadataError; } };
    } }) } };
    if (id === "../services/user.service") return { getUserByEmail: async email => {
      assert.equal(email, "customer@example.com");
      if (options.lookupError) throw options.lookupError;
      return options.missing ? null : { uid: "uid-1", authUserId: "uid-1", email: "Customer@Example.com",
        fullName: "Customer", username: "customer", verificationStatus: "pending", accountStatus: "inactive", ...options.profile };
    } };
    if (id === "../services/sessionSecurity.service") return { validateAccessSecurity: async () => {} };
    if (id === "../services/phoneAccounts.service") return { findPhoneAccounts: async () => [], PHONE_ACCOUNT_LIMIT: 3 };
    if (id === "../services/supabaseAuth.service") return { async generateSupabaseEmailLink() {
      generated++; return { actionLink: "https://example.supabase.co/auth/v1/verify?token=example-code", tokenHash: "example-code", user: { id: "uid-1" } };
    } };
    if (id === "../services/mail.service") return { async sendEmailVerificationLink(value) {
      sent++; payload = value;
      if (options.mailError) throw options.mailError;
      return { messageId: "resend-id" };
    } };
    return realRequire(id);
  };
  controller._compile(fs.readFileSync(filename, "utf8"), filename);
  return { async run() {
    let result;
    await controller.exports.resendCustomerEmailVerification({ body: { email: " Customer@Example.com " } }, {
      status(code) { assert.equal(code, 200); return this; }, json(value) { result = value; },
    });
    return { result, sent, generated, payload };
  } };
}

test("pending Supabase profile generates an activation link and invokes Resend before reporting sent", async () => {
  const { result, sent, generated, payload } = await fixture().run();
  assert.equal(sent, 1);
  assert.equal(generated, 1);
  assert.equal(result.deliveryStatus, "sent");
  assert.equal(result.messageId, "resend-id");
  assert.equal(payload.to, "customer@example.com");
  assert.equal(new URL(payload.verificationLink).searchParams.get("token_hash"), "example-code");
});

test("missing and ineligible profiles never claim an email was sent", async () => {
  for (const options of [{ missing: true }, { profile: { verificationStatus: "verified" } }]) {
    const { result, sent } = await fixture(options).run();
    assert.equal(sent, 0);
    assert.equal(result.deliveryStatus, "not_sent");
  }
});

test("cooldown, configuration, lookup and delivery failures propagate", async () => {
  await assert.rejects(fixture({ noMail: true }).run(), error => error.statusCode === 503);
  await assert.rejects(fixture({ profile: { verificationSentAt: new Date().toISOString() } }).run(), error => error.statusCode === 429);
  for (const key of ["lookupError", "mailError"]) {
    const failure = new Error("dependency failed");
    await assert.rejects(fixture({ [key]: failure }).run(), error => error === failure);
  }
});

test("accepted email remains sent when metadata persistence fails", async () => {
  assert.equal((await fixture({ metadataError: new Error("write failed") }).run()).result.deliveryStatus, "sent");
});
