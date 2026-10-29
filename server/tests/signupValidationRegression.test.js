const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { ApiError } = require("../src/utils/ApiError");

function loadService(filename, env, fetch, globals = {}) {
  const context = {
    module: { exports: {} }, URL, AbortSignal, AbortController, setTimeout, clearTimeout,
    console, fetch,
    require(id) {
      if (id === "../config/env") return { env };
      if (id === "../config/postgresDatabase") return { db: {} };
      if (id === "../utils/ApiError") return { ApiError };
      if (id.startsWith("node:")) return require(id);
      throw new Error(`Unexpected dependency: ${id}`);
    }, ...globals,
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "../src/services", filename), "utf8"), context);
  return context.module.exports;
}

test("Supabase duplicate lookup ignores unrelated and substring matches and matches normalized exact emails", async () => {
  const users = [{ id: "other", email: "other@example.com" },
    { id: "substring", email: "prefix-customer@example.com" }];
  const service = loadService("supabaseAuth.service.js", {
    supabase: { url: "https://auth.example", serviceRoleKey: "test" },
  }, async () => ({ ok: true, json: async () => ({ users }) }));
  assert.equal(await service.findSupabaseUserByEmail("customer@example.com"), null);
  users.push({ id: "exact", email: " Customer@Example.com " });
  assert.equal((await service.findSupabaseUserByEmail(" CUSTOMER@example.com ")).id, "exact");
});

test("Supabase signup accepts the raw generate_link Auth user response", async () => {
  const service = loadService("supabaseAuth.service.js", {
    supabase: { url: "https://auth.example", serviceRoleKey: "test" },
  }, async (_url, options) => {
    const body = JSON.parse(options.body);
    assert.equal(body.email, "customer@example.com");
    assert.equal(body.type, "signup");
    assert.equal(body.password, "Valid!Pass123");
    return { ok: true, json: async () => ({ id: "new-uuid", email: body.email, hashed_token: "token" }) };
  });
  const challenge = await service.generateSupabaseEmailLink({ email: "customer@example.com", type: "signup", password: "Valid!Pass123" });
  assert.equal(challenge.user.id, "new-uuid");
  assert.equal(challenge.tokenHash, "token");
});

test("IP provider failures log the network cause and pause repeated lookups, then recover", async () => {
  let calls = 0;
  let now = 100000;
  const warnings = [];
  class TestDate extends Date { static now() { return now; } }
  const service = loadService("sessionSecurity.service.js", { security: {} }, async () => {
    calls += 1;
    if (calls === 1) throw Object.assign(new TypeError("fetch failed"), { cause: { code: "ENOTFOUND" } });
    return { ok: true, json: async () => ({ location: { country_code: "PH" } }) };
  }, { Date: TestDate, console: { warn: (...args) => warnings.push(args) } });
  await service.validateAccessSecurity({ ip: "8.8.8.8" });
  await service.validateAccessSecurity({ ip: "1.1.1.1" });
  assert.equal(calls, 1);
  assert.equal(warnings[0][1].cause, "ENOTFOUND");
  now += 30001;
  await service.validateAccessSecurity({ ip: "8.8.8.8" });
  assert.equal(calls, 2);
});
