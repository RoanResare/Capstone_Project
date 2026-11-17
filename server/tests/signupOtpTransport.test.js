const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { ApiError } = require("../src/utils/ApiError");

function loadService(relativePath, dependencies, globals = {}) {
  const filename = path.resolve(__dirname, relativePath);
  const context = { module: { exports: {} }, console: { info() {}, warn() {}, error() {} },
    require(name) { assert.ok(name in dependencies, name); return dependencies[name]; }, ...globals };
  vm.runInNewContext(fs.readFileSync(filename, "utf8"), context, { filename });
  return context.module.exports;
}

test("Supabase challenge codes are extracted and verified server-side without triggering built-in email delivery", async () => {
  for (const nested of [false, true]) {
    const calls = [];
    const fields = { hashed_token: "private-hash", email_otp: "012345" };
    const service = loadService("../src/services/supabaseAuth.service.js", {
      "../config/env": { env: { supabase: { url: "https://auth.example", anonKey: "public-key", serviceRoleKey: "private-admin-key" } } },
      "../utils/ApiError": { ApiError },
    }, { AbortSignal, fetch: async (url, options) => {
      calls.push({ url, ...options, body: JSON.parse(options.body) });
      return Response.json(url.endsWith("/admin/generate_link")
        ? { ...(nested ? { properties: fields } : fields), user: { id: "identity" } }
        : { user: { id: "identity", email_confirmed_at: "2026-11-01" } });
    } });
    const challenge = await service.generateSupabaseEmailLink({ email: "customer@example.com", type: "signup", password: "ExactPassword! " });
    assert.equal(challenge.emailOtp, "012345");
    assert.equal(calls[0].body.password, "ExactPassword! ");
    const verified = await service.verifySupabaseEmailCode("customer@example.com", challenge.emailOtp);
    assert.ok(verified.user.email_confirmed_at);
    assert.deepEqual(calls[1].body, { type: "signup", email: "customer@example.com", token: "012345" });
    assert.ok(calls.every(call => !call.url.endsWith("/signup") && !call.url.endsWith("/resend")));
    assert.equal(calls[1].headers.apikey, "public-key");
  }
});

test("signup codes use the existing Resend mail transport and propagate delivery failures", async () => {
  let payload;
  let fail = false;
  const service = loadService("../src/services/mail.service.js", {
    "../config/mailer": { getMailTransportSettings: () => ({ provider: "resend" }),
      sendMail: async value => { payload = value; if (fail) throw new Error("Delivery failed"); return { id: "resend-id" }; } },
    "../config/env": { env: { runtime: { mailDeliveryReady: true, mailDeliveryMode: "resend" },
      mail: { fromName: "Clinic", fromEmail: "clinic@example.com" } } },
    "../utils/ApiError": { ApiError },
  });
  const result = await service.sendSignupVerificationCode({ to: "customer@example.com", otpCode: "012345" });
  assert.equal(result.messageId, "resend-id");
  assert.match(payload.subject, /verification code/);
  assert.match(payload.text, /012345/);
  assert.ok(!payload.html.includes("undefined"));
  assert.ok(!payload.html.includes("Two-Factor Authentication"));
  fail = true;
  await assert.rejects(service.sendSignupVerificationCode({ to: "customer@example.com", otpCode: "012345" }), error => error.statusCode === 503);
});
