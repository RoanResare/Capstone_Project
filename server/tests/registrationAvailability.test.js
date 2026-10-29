const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const express = require("express");
const { ApiError } = require("../src/utils/ApiError");

function loadCheck(options = {}) {
  const filename = path.resolve(__dirname, "../src/controllers/auth.controller.js");
  const controller = new Module(filename, module);
  controller.filename = filename;
  controller.paths = module.paths;
  const realRequire = controller.require.bind(controller);
  controller.require = (id) => {
    if (id.startsWith("node:") || id === "../constants/auth" || id === "../utils/emailValidation"
      || id === "../utils/phoneNumber") return realRequire(id);
    if (id === "../utils/ApiError") return { ApiError };
    if (id === "../services/user.service") return {
      findUserByEmailCaseInsensitive: async (email) => {
        assert.equal(email, "new.customer@gmail.com");
        return options.profile || null;
      },
    };
    if (id === "../services/supabaseAuth.service") return {
      findSupabaseUserByEmail: async () => {
        if (options.lookupError) throw options.lookupError;
        return options.authUser || null;
      },
    };
    if (id === "../utils/setupGuard") return { assertAuthSetupReady() {} };
    if (id === "../services/registrationSecurity.service") return {
      validateRegistrationSecurity: async () => ({ registrationIp: "127.0.0.1" }),
    };
    if (id === "../services/sessionSecurity.service") return { validateAccessSecurity: async () => ({}) };
    if (id === "../services/phoneAccounts.service") return {
      findPhoneAccounts: async () => options.phoneAccounts || [],
      PHONE_ACCOUNT_LIMIT: 3, PHONE_ACCOUNT_LIMIT_MESSAGE: "Phone limit reached.",
    };
    if (["../services/authAttempts.service", "../config/clientOrigins", "../config/env",
      "../services/mail.service", "../services/otp.service", "../services/token.service", "../utils/password"].includes(id)) return {};
    throw new Error(`Unexpected dependency in read-only availability check: ${id}`);
  };
  controller._compile(fs.readFileSync(filename, "utf8"), filename);
  return controller.exports.checkCustomerRegistrationAvailability;
}

async function requestCheck(options = {}) {
  const app = express();
  app.use(express.json());
  const check = loadCheck(options);
  app.post("/api/auth/register/check", (req, res, next) => Promise.resolve(check(req, res)).catch(next));
  app.use((error, _req, res, _next) => res.status(error.statusCode || 500).json({ message: error.message, details: error.details }));
  const server = app.listen(0, "127.0.0.1");
  await new Promise(resolve => server.once("listening", resolve));
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/auth/register/check`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: " New.Customer@Gmail.com ", phone: "+63 9940702702" }),
    });
    return { status: response.status, body: await response.json() };
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

test("availability allows new emails and ignores unrelated or partial lookup candidates", async () => {
  for (const options of [{}, {
    profile: { uid: "other", email: "other@gmail.com" },
    authUser: { id: "partial", email: "prefix-new.customer@gmail.com" },
  }, { profile: { uid: "missing-email" }, authUser: { id: "missing-email" } }]) {
    const result = await requestCheck(options);
    assert.equal(result.status, 200);
    assert.equal(result.body.available, true);
  }
});

test("availability returns 409 only for exact normalized email matches", async () => {
  for (const options of [
    { profile: { uid: "existing", email: " NEW.Customer@gmail.com " } },
    { authUser: { id: "existing", email: "new.customer@gmail.com" } },
  ]) {
    const result = await requestCheck(options);
    assert.equal(result.status, 409);
    assert.equal(result.body.details.code, "REGISTRATION_EMAIL_EXISTS");
  }
});

test("availability reports lookup outages as unavailable, never as duplicate emails", async () => {
  const result = await requestCheck({ lookupError: new ApiError(503, "Supabase Auth unavailable") });
  assert.equal(result.status, 503);
});

test("availability keeps the three-account phone limit separate from email conflicts", async () => {
  const result = await requestCheck({ phoneAccounts: ["one", "two", "three"] });
  assert.equal(result.status, 409);
  assert.equal(result.body.message, "Phone limit reached.");
});
