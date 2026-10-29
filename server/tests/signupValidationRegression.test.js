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
    assert.equal(body.data.full_name, "Roan Resare");
    assert.equal(body.data.role, "customer");
    assert.equal(body.options, undefined);
    return { ok: true, json: async () => ({ id: "new-uuid", email: body.email, hashed_token: "token" }) };
  });
  const challenge = await service.generateSupabaseEmailLink({ email: "customer@example.com", type: "signup", password: "Valid!Pass123",
    userMetadata: { full_name: "Roan Resare", role: "customer" } });
  assert.equal(challenge.user.id, "new-uuid");
  assert.equal(challenge.tokenHash, "token");
});

test("password Auth maps provider errors to clear security responses without treating failures as successful login", async () => {
  for (const [code, providerStatus, expectedStatus, expectedCode] of [
    ["invalid_credentials", 400, 401, "INVALID_LOGIN_CREDENTIALS"],
    ["email_not_confirmed", 400, 403, "EMAIL_VERIFICATION_REQUIRED"],
    ["user_banned", 400, 403, "ACCOUNT_BLOCKED"],
    ["not_found", 404, 503, "SUPABASE_AUTH_UNAVAILABLE"],
  ]) {
    const service = loadService("supabaseAuth.service.js", {
      supabase: { url: "https://auth.example", anonKey: "test" },
    }, async () => ({ ok: false, status: providerStatus, json: async () => ({ code, msg: "Provider failure" }) }),
    { console: { error() {} } });
    await assert.rejects(service.signInWithSupabasePassword("user@gmail.com", "password"),
      error => error.statusCode === expectedStatus && error.details.code === expectedCode);
  }
});

test("OTP session exchange never generates a magic link for an unverified or mismatched identity", async () => {
  for (const identity of [
    { id: "auth-id", email: "user@gmail.com", email_confirmed_at: null },
    { id: "other-id", email: "user@gmail.com", email_confirmed_at: "2026-01-01" },
  ]) {
    let calls = 0;
    const service = loadService("supabaseAuth.service.js", { supabase: { url: "https://auth.example", serviceRoleKey: "test" } },
      async url => { calls++; assert.match(url, /\/admin\/users\/auth-id$/); return { ok: true, json: async () => identity }; });
    await assert.rejects(service.createSupabaseSessionForUser("user@gmail.com", "auth-id"), error => error.statusCode === 403);
    assert.equal(calls, 1);
  }
});

test("OTP exchange returns only the same verified identity and rejects an identity switch", async () => {
  for (const finalId of ["auth-id", "different-id"]) {
    let calls = 0;
    const service = loadService("supabaseAuth.service.js", {
      supabase: { url: "https://auth.example", serviceRoleKey: "test", anonKey: "test" },
    }, async url => {
      calls++;
      const payload = url.endsWith("/admin/users/auth-id")
        ? { id: "auth-id", email: "user@gmail.com", email_confirmed_at: "2026-01-01" }
        : url.endsWith("/admin/generate_link") ? { hashed_token: "challenge" }
          : { access_token: "access", refresh_token: "refresh", user: { id: finalId } };
      return { ok: true, json: async () => payload };
    });
    if (finalId === "auth-id") assert.equal((await service.createSupabaseSessionForUser("user@gmail.com", "auth-id")).user.id, "auth-id");
    else await assert.rejects(service.createSupabaseSessionForUser("user@gmail.com", "auth-id"), error => error.statusCode === 403);
    assert.equal(calls, 3);
  }
});

test("protected Supabase session verification rejects unconfirmed emails", async () => {
  for (const confirmed of [false, true]) {
    const token = `header.${Buffer.from(JSON.stringify({ iss: "https://auth.example/auth/v1", sub: "auth-id" })).toString("base64url")}.signature`;
    const service = loadService("supabaseAuth.service.js", {
      runtime: { supabaseAuthReady: true }, supabase: { url: "https://auth.example", anonKey: "test" },
    }, async () => ({ ok: true, json: async () => ({ id: "auth-id", email: "user@gmail.com", email_confirmed_at: confirmed ? "2026-01-01" : null }) }), { Buffer });
    if (confirmed) assert.equal((await service.verifySupabaseAccessToken(token)).uid, "auth-id");
    else await assert.rejects(service.verifySupabaseAccessToken(token), error => error.statusCode === 403);
  }
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
