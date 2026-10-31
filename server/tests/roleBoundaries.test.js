const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { ApiError } = require("../src/utils/ApiError");

function loadService(user) {
  const modules = {
    "../config/postgresDatabase": { db: { collection() { return { doc() { return { async get() { return { exists: Boolean(user), data: () => user }; } }; } }; } } },
    "./supabaseAuth.service": {},
    "../config/env": { env: { nodeEnv: "test", runtime: {} } },
    "../constants/auth": require("../src/constants/auth"),
    "../utils/ApiError": { ApiError },
    "./registrationSecurity.service": {},
    "../utils/phoneNumber": {},
  };
  const context = { module: { exports: {} }, require(name) {
    if (!(name in modules)) throw new Error(`Unexpected dependency: ${name}`);
    return modules[name];
  }, importModuleDynamically: async () => ({ assertAppropriateText() {}, ACCOUNT_TEXT_FIELDS: [] }) };
  vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, "../src/services/user.service.js"), "utf8"), context, {
    importModuleDynamically: async () => ({ assertAppropriateText() {}, ACCOUNT_TEXT_FIELDS: [] }),
  });
  context.module.exports.getUserByUid = async () => user;
  return context.module.exports;
}

test("employee-management service refuses customer profiles even if invoked directly", async () => {
  const service = loadService({ uid: "customer", role: "customer", email: "customer@example.com" });
  await assert.rejects(service.updatePortalUser("customer", { fullName: "Changed" }),
    error => error.statusCode === 400 && /Only admin and staff/.test(error.message));
});

test("employee-management service cannot change employee roles to customer or an unknown role", async () => {
  for (const role of ["customer", "unknown", ""]) {
    const service = loadService({ uid: "staff", role: "staff", email: "staff@example.com" });
    await assert.rejects(service.updatePortalUser("staff", { role }),
      error => error.statusCode === 400 && /Employee roles must be admin or staff/.test(error.message));
  }
});

test("self-service profile updates reject permission fields", async () => {
  const service = loadService({ uid: "customer", role: "customer", email: "customer@example.com" });
  await assert.rejects(service.updateOwnUser("customer", { role: "staff" }),
    error => error.statusCode === 400 && /cannot change account role/.test(error.message));
});
