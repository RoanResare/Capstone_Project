const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { createRequire } = require("node:module");
const { ApiError } = require("../src/utils/ApiError");
const { hashPassword } = require("../src/utils/password");

function fixture() {
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
  const user = { uid: "actor", email: "actor@example.com", role: "admin", accountStatus: "active", passwordHash: hashPassword("Own!Password") };
  let providerCalls = 0, mutations = 0, providerError = null;
  const timestamp = date => ({ toDate: () => date });
  const mocks = {
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
    "../services/firebaseAuth.service": { signInWithEmailAndPassword: async (email, password) => {
      providerCalls++;
      if (providerError) throw providerError;
      if (password !== "Own!Password") throw new ApiError(401, "Invalid email or password.", { firebaseCode: "INVALID_LOGIN_CREDENTIALS" });
      return { localId: user.uid };
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
        if (id === "../utils/otp") return { generateOtpCode: () => "123456", hashOtpCode: value => "hash:" + value };
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

test("five failed logins lock both username and email for five minutes, including correct credentials", async () => {
  const f = fixture();
  for (let i = 0; i < 4; i++) await assert.rejects(f.controller.checkCredentials(i % 2 ? "actor" : f.user.email, "wrong"), { statusCode: 401 });
  await assert.rejects(f.controller.checkCredentials("actor", "wrong"), locked);
  assert.equal(f.providerCalls(), 5);
  await assert.rejects(f.controller.checkCredentials(f.user.email, "Own!Password"), locked);
  assert.equal(f.providerCalls(), 5);
  f.advance(299999);
  await assert.rejects(f.controller.checkCredentials("actor", "Own!Password"), locked);
  f.advance(1);
  await f.controller.checkCredentials("actor", "Own!Password");
  await assert.rejects(f.controller.checkCredentials("actor", "wrong"), error => /4 attempts remaining/.test(error.message));
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
  let challenge = await f.otp.createOtpVerification(f.user);
  const verify = code => f.otp.verifyOtpCode({ otpId: challenge.otpId, otpCode: code, user: f.user });
  for (let i = 0; i < 3; i++) await assert.rejects(verify("wrong"), { statusCode: 400 });
  challenge = await f.otp.createOtpVerification(f.user);
  await assert.rejects(verify("wrong"), { statusCode: 400 });
  await assert.rejects(verify("wrong"), locked);
  await assert.rejects(verify("123456"), locked);
  await assert.rejects(f.otp.createOtpVerification(f.user), locked);
  await assert.rejects(f.controller.checkCredentials("actor", "Own!Password"), locked);
  f.advance(300000);
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
