const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { createRequire } = require("node:module");
const { ApiError } = require("../src/utils/ApiError");
const { errorHandler } = require("../src/middlewares/errorHandler");
const { hashPassword } = require("../src/utils/password");

function fixture(role = "admin") {
  let clock = Date.parse("2030-01-01T12:00:00Z");
  class TestDate extends Date {
    constructor(...args) { super(...(args.length ? args : [clock])); }
    static now() { return clock; }
  }
  const records = new Map();
  const snapshot = ref => ({ exists: records.has(ref.key), data: () => records.get(ref.key), ref });
  let sequence = 0;
  const ref = key => ({ key, id: key.split("/").at(-1), get: async () => snapshot(ref(key)),
    set: async value => records.set(key, value) });
  const query = (collection, filters = []) => ({
    where: (field, op, value) => query(collection, [...filters, [field, value]]),
    orderBy() { return this; }, limit() { return this; },
    get: async () => {
      const docs = [...records].filter(([key, data]) => key.startsWith(collection + "/") && filters.every(([field, value]) => data[field] === value))
        .map(([key]) => snapshot(ref(key)));
      return { docs, empty: !docs.length };
    },
  });
  let chain = Promise.resolve();
  const db = {
    collection: name => ({ ...query(name), doc: id => ref(`${name}/${id || ++sequence}`) }),
    batch: () => { const pending = []; return { update: (ref, data) => pending.push([ref, data]),
      commit: async () => pending.forEach(([ref, data]) => records.set(ref.key, { ...records.get(ref.key), ...data })) }; },
    runTransaction(action) {
      const result = chain.then(async () => {
        const pending = [];
        const result = await action({ get: async ref => snapshot(ref),
          set: (ref, data) => pending.push([ref, data]), update: (ref, data) => pending.push([ref, { ...records.get(ref.key), ...data }]) });
        pending.forEach(([ref, data]) => records.set(ref.key, data));
        return result;
      });
      chain = result.catch(() => {});
      return result;
    },
  };
  const user = { uid: "actor", authUserId: "actor", email: "actor@example.com", role, accountStatus: "active", passwordHash: hashPassword("Own!Password") };
  let providerCalls = 0, mutations = 0, providerError = null;
  const timestamp = date => ({ toDate: () => date });
  const mocks = {
    "../config/postgresDatabase": { db },
    "../config/firebaseAdmin": { db, admin: { firestore: { Timestamp: { now: () => timestamp(new TestDate()), fromDate: timestamp } } } },
    "../utils/ApiError": { ApiError }, "../utils/setupGuard": { assertAuthSetupReady() {} },
    "../config/env": { env: { nodeEnv: "production", otp: { ttlMinutes: 5, maxAttempts: 5, codeLength: 6, resendCooldownSeconds: 0 } } },
    "../services/registrationSecurity.service": { assertEmailIsDeliverable: async () => {} },
    "../services/user.service": {
      getUserByUid: async () => user, getUserByEmail: async () => user,
      getUsernameOwner: async username => username === "actor" ? { email: user.email } : null,
      getUserByUsername: async () => null,
      ensureAdminCanMutateTarget: async () => {}, toPublicUser: value => value,
      createPortalUser: async value => { mutations++; return value; },
      updatePortalUser: async (uid, value) => { mutations++; return value; },
      deletePortalUser: async () => { mutations++; },
    },
    "../services/supabaseAuth.service": { signInWithSupabasePassword: async (email, password) => {
      providerCalls++;
      if (providerError) throw providerError;
      if (password !== "Own!Password") throw new ApiError(401, "Invalid email, username, or password.", { code: "INVALID_LOGIN_CREDENTIALS", supabaseCode: "INVALID_LOGIN_CREDENTIALS" });
      return { user: { id: user.authUserId, email: user.email, email_confirmed_at: "verified" } };
    } },
  };
  const loaded = {};
  function load(relative, extra = "") {
    const filename = path.resolve(__dirname, "../src", relative);
    const localRequire = createRequire(filename);
    const context = { module: { exports: {} }, Date: TestDate, URL, console: { info() {}, warn() {}, error() {} },
      require(id) {
        if (id.endsWith("authAttempts.service")) return loaded.attempts;
        if (id === "./authAttempts.service") return loaded.attempts;
        if (id === "../config/firebaseAdmin") return mocks[id];
        if (id === "../config/postgresDatabase") return { db };
        if (id === "../database/values") return { Timestamp: {
          now: () => ({ toDate: () => new TestDate() }),
          fromDate: date => ({ toDate: () => new TestDate(date.getTime()) }),
        } };
        if (id === "../utils/otp") return { generateOtpCode: () => "123456", hashOtpCode: value => "hash:" + value };
        if (id === "../services/supabaseAuth.service") return mocks[id];
        if (id === "../services/phoneAccounts.service") return {};
        if (id === "../services/sessionSecurity.service") return {};
        if (id === "../services/trustedDevice.service") return { isTrustedDevice: async () => false,
          issueTrustedDevice: async () => "", revokeCurrentTrustedDevice: async () => {}, revokeTrustedDevicesForUser: async () => 0 };
        return mocks[id] || localRequire(id);
      } };
    vm.runInNewContext(fs.readFileSync(filename, "utf8") + extra, context, { filename });
    return context.module.exports;
  }
  loaded.attempts = load("services/authAttempts.service.js");
  const otp = load("services/otp.service.js");
  mocks["../services/otp.service"] = otp;
  const controller = load("controllers/auth.controller.js", "\nmodule.exports.checkCredentials = verifyLoginCredentials;");
  const users = load("controllers/user.controller.js");
  const res = { status() { return this; }, json(value) { return value; } };
  const request = body => ({ body, params: { uid: "target" }, auth: { user } });
  return { ...loaded.attempts, records, user, otp, controller, users, res, request,
    setProviderError: error => { providerError = error; },
    advance: ms => { clock += ms; }, providerCalls: () => providerCalls, mutations: () => mutations };
}

const locked = error => error.statusCode === 429 && error.details.code === "AUTH_ATTEMPTS_LOCKED" && error.details.retryAfterSeconds > 0;

test("HTTP auth errors preserve remaining attempts and server lock expiry in the JSON details", () => {
  for (const [statusCode, message, details] of [
    [401, "Invalid credentials. 3 attempts remaining.", { code: "INVALID_LOGIN_CREDENTIALS", attemptsRemaining: 3 }],
    [429, "Too many failed attempts. Please try again in 60 seconds.", {
      code: "AUTH_ATTEMPTS_LOCKED", attemptsRemaining: 0, retryAfterSeconds: 60,
      lockedUntil: "2030-01-01T12:01:00.000Z", scope: "login",
    }],
  ]) {
    const response = {};
    const res = {
      status(value) { response.statusCode = value; return this; },
      json(value) { response.body = value; return this; },
    };
    errorHandler(new ApiError(statusCode, message, details), null, res, () => {});
    assert.equal(response.statusCode, statusCode);
    assert.equal(response.body.message, message);
    assert.deepEqual(response.body.details, details);
  }
});

test("customer, admin, and staff receive exact remaining attempts and a server-timed one-minute lockout", async () => {
  for (const role of ["customer", "admin", "staff"]) {
    const f = fixture(role);
    for (let attempt = 1; attempt <= 4; attempt++) {
      const remaining = 5 - attempt;
      await assert.rejects(f.controller.checkCredentials(attempt % 2 ? f.user.email : "actor", "wrong"), error =>
        error.statusCode === 401
          && error.details.code === "INVALID_LOGIN_CREDENTIALS"
          && error.details.attemptsRemaining === remaining
          && error.message === `Invalid credentials. ${remaining} attempt${remaining === 1 ? "" : "s"} remaining.`);
    }
    await assert.rejects(f.controller.checkCredentials("actor", "wrong"), error =>
      locked(error) && error.details.retryAfterSeconds === 60
        && error.details.lockedUntil === "2030-01-01T12:01:00.000Z"
        && error.message === "Too many failed attempts. Please try again in 60 seconds.");
    assert.equal(f.providerCalls(), 5);
    await assert.rejects(f.controller.checkCredentials(f.user.email, "Own!Password"), locked);
    assert.equal(f.providerCalls(), 5);
    f.advance(59999);
    await assert.rejects(f.controller.checkCredentials("actor", "Own!Password"), locked);
    f.advance(1);
    await f.controller.checkCredentials("actor", "Own!Password");
    await assert.rejects(f.controller.checkCredentials("actor", "wrong"), error =>
      error.details.attemptsRemaining === 4 && /4 attempts remaining/.test(error.message));
  }
});

test("successful credentials reset consecutive failures; provider outages do not increment them", async () => {
  const f = fixture();
  for (let i = 0; i < 4; i++) await assert.rejects(f.controller.checkCredentials("actor", "wrong"));
  await f.controller.checkCredentials("actor", "Own!Password");
  await assert.rejects(f.controller.checkCredentials("actor", "wrong"), { statusCode: 401 });
  f.setProviderError(new Error("Provider unavailable"));
  await assert.rejects(f.controller.checkCredentials("actor", "wrong"), /Provider unavailable/);
  const state = await f.attemptReference("login", f.user.email).get();
  assert.equal(state.data().failures, 1);
});

test("OTP failures accumulate across resends; lock blocks verification, resend, and fresh login until expiry", async () => {
  const f = fixture();
  let challenge;
  const verify = code => f.otp.verifyOtpCode({ otpId: challenge.otpId, otpCode: code, user: f.user });
  for (let i = 0; i < 4; i++) {
    challenge = await f.otp.createOtpVerification(f.user);
    await assert.rejects(verify("wrong"), { statusCode: 400 });
  }
  challenge = await f.otp.createOtpVerification(f.user);
  await assert.rejects(verify("wrong"), locked);
  await assert.rejects(verify("123456"), locked);
  await assert.rejects(f.otp.createOtpVerification(f.user), locked);
  await assert.rejects(f.assertAttemptsAllowed("otp", f.user.uid), locked);
  await f.controller.checkCredentials("actor", "Own!Password");
  f.advance(299999);
  await assert.rejects(f.otp.createOtpVerification(f.user), locked);
  f.advance(1);
  challenge = await f.otp.createOtpVerification(f.user);
  await verify("123456");
  await assert.rejects(verify("123456"), { statusCode: 409 });
});

test("successful OTP resets failures, and concurrent failures cannot lose increments", async () => {
  const f = fixture();
  const challenge = await f.otp.createOtpVerification(f.user);
  for (let i = 0; i < 4; i++) await assert.rejects(f.otp.verifyOtpCode({ otpId: challenge.otpId, otpCode: "wrong", user: f.user }));
  await f.otp.verifyOtpCode({ otpId: challenge.otpId, otpCode: "123456", user: f.user });
  assert.equal((await f.attemptReference("otp", f.user.uid).get()).data().failures, 0);
  await Promise.allSettled(Array.from({ length: 7 }, () => f.recordFailedAttempt("login", "concurrent@example.com")));
  assert.equal((await f.attemptReference("login", "concurrent@example.com").get()).data().failures, 5);
  await assert.rejects(f.resetAttempts("login", "concurrent@example.com"), locked);
});

test("employee create, edit, and delete reject missing or target passwords and accept only the account holder's password", async () => {
  const f = fixture();
  const create = { fullName: "New Staff", email: "new@example.com", username: "newstaff", role: "staff", password: "Target!Password" };
  for (const [method, payload] of [["createUser", create], ["updateUser", { fullName: "Changed", password: "Target!Password" }], ["removeUser", {}]]) {
    await assert.rejects(f.users[method](f.request(payload), f.res), { statusCode: 400 });
    await assert.rejects(f.users[method](f.request({ ...payload, currentPassword: "Target!Password" }), f.res), { statusCode: 403 });
    assert.equal(f.mutations(), method === "createUser" ? 0 : method === "updateUser" ? 1 : 2);
    await f.users[method](f.request({ ...payload, currentPassword: "Own!Password" }), f.res);
  }
  assert.equal(f.mutations(), 3);
});
