const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { test } = require("node:test");
const { ApiError } = require("../src/utils/ApiError");

function loadService(filename, dependencies, globals = {}) {
  const context = {
    module: { exports: {} },
    require: (name) => {
      if (name === "../utils/ApiError") return { ApiError };
      if (name === "../utils/emailValidation") return require("../src/utils/emailValidation");
      if (name.startsWith("node:") && !(name in dependencies)) return require(name);
      if (!(name in dependencies)) throw new Error(`Unexpected dependency: ${name}`);
      return dependencies[name];
    },
    URL, AbortController, setTimeout, clearTimeout,
    console: { log() {}, warn() {} }, ...globals,
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "../src/services", filename), "utf8"), context);
  return context.module.exports;
}


function registrationService() {
  return loadService("registrationSecurity.service.js", {
    "../config/env": { env: { security: { failClosed: true, geoLookupUrl: "https://example.org/vpn" } } },
  }, { fetch: async () => assert.fail("No network/IP provider should be called") });
}

const response = (data) => ({ ok: true, json: async () => data });

test("registration records IP only and never blocks on VPN, geography, unknown IP, or shared networks", async () => {
  const service = registrationService();
  assert.equal(service.validateAccessSecurity, undefined);
  for (const ip of ["1.2.3.4", "8.8.8.8", "::1", "unknown", "2001:4860:4860::8888"]) {
    const result = await service.validateRegistrationSecurity({ ip }, "customer@gmail.com");
    assert.equal(result.registrationIp, ip);
  }
});

function sessionSecurityService({ fetch = async () => response({ country: "Philippines" }), records = new Map(), revocations = [], security = {}, globals = {} } = {}) {
  let transactionTail = Promise.resolve();
  const db = {
    collection: (name) => ({ doc: (id) => ({
      id,
      key: `${name}/${id}`,
      get: async () => ({ data: () => records.get(`${name}/${id}`) }),
      set: async (value, options = {}) => {
        const key = `${name}/${id}`;
        records.set(key, options.merge ? { ...records.get(key), ...value } : value);
      },
    }) }),
    runTransaction: (action) => {
      const operation = transactionTail.then(() => action({
        get: async (ref) => ({ data: () => records.get(ref.key) }),
        set: (ref, value) => records.set(ref.key, { ...records.get(ref.key), ...value }),
      }));
      transactionTail = operation.catch(() => {});
      return operation;
    },
  };
  return loadService("sessionSecurity.service.js", {
    "../config/firebaseAdmin": { db, auth: { revokeRefreshTokens: async (uid) => { revocations.push(uid); } } },
    "../config/env": { env: { security: {
      geoLookupUrl: "https://api.ipapi.is/?q={ip}&key={api_key}",
      geoLookupApiKey: "test-key",
      ...security,
    } } },
  }, { fetch, ...globals });
}

test("login and session security call ipapi.is and block explicit VPN, proxy, Tor, or hosting flags", async () => {
  for (const flag of ["is_vpn", "is_proxy", "is_tor", "is_hosting"]) {
    const calls = [];
    const service = sessionSecurityService({
      fetch: async (url) => {
        calls.push(url);
        return response({ ip: "8.8.8.8", country: "Philippines", [flag]: true });
      },
    });
    await assert.rejects(service.validateAccessSecurity({ ip: "8.8.8.8" }),
      { statusCode: 403, message: "Blocked VPN IP address" });
    assert.deepEqual(calls, ["https://api.ipapi.is/?q=8.8.8.8&key=test-key"]);
  }
});

test("foreign or missing countries allow login and active sessions without explicit flags", async () => {
  for (const data of [
    { company: "Cloudflare, Inc.", country: "Japan", is_vpn: false },
    { country: "Singapore", is_proxy: false, is_hosting: false },
    { country: "Hong Kong", is_vpn: false, is_tor: false },
    { location: { country: "Japan", country_code: "JP" } },
    { location: { country: "Philippines", country_code: "JP" } },
    {},
  ]) {
    const revocations = [];
    const service = sessionSecurityService({ fetch: async () => response(data), revocations });
    assert.equal((await service.validateAccessSecurity({ ip: "172.70.223.199" })).checked, true);
    await service.validateSessionSecurity({
      ip: "172.70.223.199", auth: { user: { uid: "user" }, claims: { iat: 10 } },
    });
    assert.deepEqual(revocations, []);
  }
});

test("known VPN and hosting names or classifications block even with false VPN flags", async () => {
  for (const data of [
    { company: "Proton AG" },
    { company: { name: "Proton Technologies AG" } },
    { asn: "AS209103 Proton AG" },
    { asn: { org: "ProtonVPN AG" } },
    { asn: { name: "Windscribe Limited" } },
    { company_name: "Privado Networks AG" },
    { asn_org: "TunnelBear, LLC" },
    { company: { name: "  PROTON, AG  " } },
    { company: { name: "Unlisted hosting provider", type: "hosting" } },
    { asn: { org: "Unlisted data center", type: "HOSTING" } },
    { company: "Hetzner Online GmbH" },
    { asn: { org: "DigitalOcean, LLC" } },
    { company: "Amazon Data Services Japan" },
    { is_datacenter: true },
    { egress_service: { type: "private_relay", provider: "Cloudflare WARP" } },
    { egress_service: { type: "secure_web_gateway", provider: "Zscaler" } },
  ]) {
    const revocations = [];
    const service = sessionSecurityService({ fetch: async () => response({
      ...data, is_vpn: false, is_proxy: false, is_tor: false, is_hosting: false,
    }), revocations });
    await assert.rejects(service.validateAccessSecurity({ ip: "8.8.8.8" }), { statusCode: 403 });
    await assert.rejects(service.validateSessionSecurity({
      ip: "8.8.8.8", auth: { user: { uid: "user" }, claims: { iat: 10 } },
    }), { statusCode: 403, message: "Your session was terminated because your IP address changed..." });
    assert.deepEqual(revocations, ["user"]);
  }
});

test("local carriers and unrelated shared networks allow clean re-baselining", async () => {
  for (const data of [
    { company: "DITO Telecommunity Corporation", country: "Hong Kong" },
    { asn: "AS4775 Globe Telecoms", country: "Singapore" },
    { company: { name: "Globe Telecom, Inc." } },
    { asn: { org: "Smart Communications, Inc." } },
    { company: "PLDT Inc." },
    { company: "Converge ICT Solutions", country: "PHILIPPINES" },
    { company: { name: "Sky Cable Corporation" }, country: "Philippines" },
    { asn: { org: "Sky Broadband" }, country: "philippines" },
    { company: "An unlisted residential ISP", country: "pHiLiPpInEs" },
    { company: "Philippine Long Distance Telephone Company" },
    { company: "DITO Telecommunity", asn: "AS123 DITO Telecommunity" },
    { company: { name: "Unknown local fiber network", type: "isp" }, asn: { type: "isp" }, country: "Singapore" },
    { egress_service: { type: "satellite", provider: "Starlink" } },
    { company: "Cloudflare, Inc." },
    { company: "Proton Automotive" },
    { company: "NotWindscribe Networks" },
  ]) {
    const records = new Map([["sessionConnections/session", { uid: "user", ip: "1.1.1.1" }]]);
    const revocations = [];
    const service = sessionSecurityService({ fetch: async () => response(data), records, revocations });
    await service.validateAccessSecurity({ ip: "8.8.8.8" });
    for (const ip of ["8.8.8.8", "1.1.1.1", "8.8.8.8"]) {
      await service.validateSessionSecurity({
        ip, auth: { user: { uid: "user" }, claims: { iat: 10, sessionId: "session" } },
      });
      assert.equal(records.get("sessionConnections/session").ip, ip);
    }
    assert.deepEqual(revocations, []);
  }
});

test("explicit threat flags block local and foreign networks regardless of company or country", async () => {
  for (const flag of ["is_vpn", "is_proxy", "is_tor", "is_hosting"]) {
    for (const company of ["Globe Telecom, Inc.", "Converge ICT Solutions", "Sky Cable", "Proton AG"]) {
      const revocations = [];
      const service = sessionSecurityService({ fetch: async () => response({
        company, country: company === "Proton AG" ? "Japan" : "Philippines", [flag]: true,
      }), revocations });
      await assert.rejects(service.validateAccessSecurity({ ip: "8.8.8.8" }), { statusCode: 403 });
      await assert.rejects(service.validateSessionSecurity({
        ip: "8.8.8.8", auth: { user: { uid: "user" }, claims: { iat: 10 } },
      }), { statusCode: 403, message: "Your session was terminated because your IP address changed..." });
      assert.deepEqual(revocations, ["user"]);
    }
  }
});

test("clean Philippine country names and codes allow access", async () => {
  for (const data of [
    { country: "Philippines" }, { country: " philippines " },
    { country_code: "PH" }, { country: "PHL" },
    { location: { country: "Philippines", country_code: "PH" } },
  ]) {
    const service = sessionSecurityService({ fetch: async () => response(data) });
    assert.equal((await service.validateAccessSecurity({ ip: "8.8.8.8" })).checked, true);
  }
});

test("clean IP changes update the session baseline; VPN activation terminates the session", async () => {
  const records = new Map([
    ["sessionSecurity/user", { revokedBefore: 0 }],
    ["sessionConnections/session-1", { uid: "user", ip: "8.8.8.8" }],
  ]);
  const revocations = [];
  const service = sessionSecurityService({
    records,
    revocations,
    fetch: async (url) => response({
      country: url.includes("9.9.9.9") ? "Japan" : "Hong Kong",
      is_vpn: url.includes("9.9.9.9"),
      is_proxy: false,
      is_tor: false,
      is_hosting: false,
    }),
  });
  const req = {
    ip: "1.1.1.1",
    auth: { user: { uid: "user" }, claims: { sub: "user", iat: 10, sessionId: "session-1" } },
  };

  await service.validateSessionSecurity(req);
  assert.equal(records.get("sessionConnections/session-1").ip, "1.1.1.1");
  assert.deepEqual(revocations, []);

  req.ip = "8.8.8.8";
  await service.validateSessionSecurity(req);
  req.ip = "1.1.1.1";
  await service.validateSessionSecurity(req);
  assert.equal(records.get("sessionConnections/session-1").ip, "1.1.1.1");
  assert.deepEqual(revocations, []);

  req.ip = "9.9.9.9";
  await assert.rejects(service.validateSessionSecurity(req),
    { statusCode: 403, message: "Your session was terminated because your IP address changed..." });
  assert.deepEqual(revocations, ["user"]);
});

test("configured IPv4 and IPv6 VPN ranges block without a provider lookup and leave adjacent IPs clean", async () => {
  const calls = [];
  const service = sessionSecurityService({
    security: { blockedNetworkCidrs: "8.8.8.0/24, 2001:4860:abcd::/48" },
    fetch: async (url) => { calls.push(url); return response({ company: { type: "isp" } }); },
  });
  for (const ip of ["8.8.8.0", "8.8.8.255", "2001:4860:abcd::1234"]) {
    await assert.rejects(service.validateAccessSecurity({ ip }), { statusCode: 403 });
  }
  assert.equal(calls.length, 0);
  for (const ip of ["8.8.9.1", "2001:4860:abce::1234"]) {
    await service.validateAccessSecurity({ ip });
  }
  assert.equal(calls.length, 2);
  for (const cidr of ["invalid/24", "8.8.8.0/33", "2001:4860::/129", "8.8.8.0/", "8.8.8.0/24/1"]) {
    assert.throws(() => sessionSecurityService({ security: { blockedNetworkCidrs: cidr } }), /invalid IP address or CIDR/);
  }
});

test("late VPN checks and replayed tokens cannot revoke a fresh clean session", async () => {
  let time = 100000;
  let finishLate;
  let startLate;
  const started = new Promise((resolve) => { startLate = resolve; });
  const records = new Map();
  const revocations = [];
  const service = sessionSecurityService({ records, revocations,
    globals: { Date: class extends Date { static now() { return time; } } },
    fetch: async (url) => {
      if (url.includes("9.9.9.9")) {
        startLate();
        await new Promise((resolve) => { finishLate = resolve; });
        return response({ company: "Proton AG", is_vpn: false });
      }
      return response(url.includes("8.8.8.8") ? { is_datacenter: true } : { company: { type: "isp" } });
    },
  });
  const oldAuth = { user: { uid: "user" }, claims: { iat: 10 } };
  const late = assert.rejects(service.validateSessionSecurity({ ip: "9.9.9.9", auth: oldAuth }), { statusCode: 403 });
  await started;
  await assert.rejects(service.validateSessionSecurity({ ip: "8.8.8.8", auth: oldAuth }), { statusCode: 403 });
  const cutoff = records.get("sessionSecurity/user").revokedBefore;
  time = 101100;
  await service.waitForFreshSession("user", { now: () => time, sleep: () => assert.fail("Clean recovery should not wait past the cutoff") });
  const binding = await service.createFreshSessionBinding({ uid: "user" }, { ip: "1.1.1.1" });
  const freshRequest = { ip: "1.1.1.1", auth: { user: { uid: "user" }, claims: { iat: 101, sessionId: binding.sessionId } } };
  await service.validateSessionSecurity(freshRequest);
  time = 102000;
  finishLate();
  await late;
  assert.equal(records.get("sessionSecurity/user").revokedBefore, cutoff);
  assert.deepEqual(revocations, ["user"]);
  await assert.rejects(service.validateSessionSecurity({ ip: "1.1.1.1", auth: oldAuth }), { statusCode: 401 });
  await service.validateSessionSecurity(freshRequest);
});

test("simultaneous VPN violations revoke refresh tokens only once", async () => {
  const revocations = [];
  const service = sessionSecurityService({ fetch: async () => response({ is_vpn: true }), revocations });
  const req = { ip: "8.8.8.8", auth: { user: { uid: "user" }, claims: { iat: 10 } } };
  await Promise.all([assert.rejects(service.validateSessionSecurity(req), { statusCode: 403 }),
    assert.rejects(service.validateSessionSecurity(req), { statusCode: 403 })]);
  assert.deepEqual(revocations, ["user"]);
});

test("anonymous provider responses produce one concise warning without logging credentials", async () => {
  const warnings = [];
  const service = sessionSecurityService({
    fetch: async () => response({ company: "Local ISP", docs: "https://ipapi.is/free-tier.html" }),
    globals: { console: { warn: (...args) => warnings.push(args) } },
  });
  await service.validateAccessSecurity({ ip: "8.8.8.8" });
  await service.validateAccessSecurity({ ip: "1.1.1.1" });
  assert.equal(warnings.length, 1);
  assert.match(warnings[0][0], /FRAUD_GEO_LOOKUP_API_KEY/);
  assert.doesNotMatch(JSON.stringify(warnings), /test-key/);
});

test("login, OTP, and session middleware create and validate clean session bindings", () => {
  for (const file of ["controllers/auth.controller.js", "middlewares/authenticate.js"]) {
    const source = fs.readFileSync(path.join(__dirname, "../src", file), "utf8");
    assert.match(source, /validateAccessSecurity|validateSessionSecurity|createFreshSessionBinding/);
  }
  const source = fs.readFileSync(path.join(__dirname, "../src/services/sessionSecurity.service.js"), "utf8");
  assert.match(source, /getClientIp/);
  assert.match(source, /validateAccessSecurity/);
  assert.match(source, /sessionConnections/);
});

function middlewareFor(user, claims, firebase = false) {
  return loadService("../middlewares/authenticate.js", {
    "../config/firebaseAdmin": { auth: { verifyIdToken: async () => claims } },
    "../config/env": { env: { auth: { jwtSecret: "test" }, runtime: { firebaseAdminReady: true } } },
    "../services/token.service": { verifyAccessToken: () => {
      if (firebase) throw new ApiError(401, "Not a server token");
      return claims;
    } },
    "../services/user.service": { getUserByUid: async () => user, toPublicUser: (value) => value },
    "../services/sessionSecurity.service": { validateSessionSecurity: async () => {} },
    "../constants/auth": { USER_STATUSES: { ACTIVE: "active" }, FRAUD_STATUSES: { SUSPENDED: "suspended", BANNED: "banned" } },
  });
}

test("both token types authorize every role after session security passes", async () => {
  for (const role of ["customer", "admin", "staff"]) {
    const claims = { sub: role, role, email: role + "@gmail.com", accountStatus: "active",
      connectionIp: "9.9.9.9", sessionId: "historic-session" };
    const user = { uid: role, ...claims };
    for (const firebase of [false, true]) {
      const middleware = middlewareFor(user, claims, firebase);
      for (const ip of ["1.2.3.4", "5.6.7.8", "::1", "unknown"]) {
        const req = { ip, headers: { authorization: "Bearer test" } };
        let called = false;
        await middleware.verifyToken(req, {}, (error) => { assert.equal(error, undefined); called = true; });
        assert.equal(called, true);
        assert.equal(req.auth.user.uid, role);
      }
    }
    const middleware = middlewareFor(user, claims);
    let called = false;
    await middleware.verifySessionToken({ headers: { authorization: "Bearer test" } }, {},
      (error) => { assert.equal(error, undefined); called = true; });
    assert.equal(called, true);
  }
});

test("authentication still rejects missing tokens and banned/inactive accounts", async () => {
  const claims = { sub: "user", role: "customer", email: "customer@gmail.com", accountStatus: "active" };
  for (const changes of [{ accountStatus: "inactive" }, { fraudStatus: "banned" }, { fraudStatus: "suspended" }]) {
    const middleware = middlewareFor({ uid: "user", ...claims, ...changes }, claims);
    await middleware.verifyToken({ headers: { authorization: "Bearer test" } }, {}, (error) => {
      assert.equal(error.statusCode, 403);
    });
  }
  const middleware = middlewareFor({ uid: "user", ...claims }, claims);
  await middleware.verifyToken({ headers: {} }, {}, (error) => assert.equal(error.statusCode, 401));
});

test("historic pending revocations recover at login", async () => {
  let time = 200250;
  let revocations = 0;
  const records = new Map([["user", { revokedBefore: 100, revocationPending: true }]]);
  const db = {
    collection: (name) => {
      assert.equal(name, "sessionSecurity");
      return { doc: (uid) => ({ uid, get: async () => ({ data: () => records.get(uid) }) }) };
    },
    runTransaction: async (action) => action({
      get: async (ref) => ({ data: () => records.get(ref.uid) }),
      set: (ref, value) => records.set(ref.uid, { ...records.get(ref.uid), ...value }),
    }),
  };
  const service = loadService("sessionSecurity.service.js", {
    "../config/firebaseAdmin": { db, auth: { revokeRefreshTokens: async () => { revocations++; } } },
    "../config/env": { env: { security: {} } },
  });
  assert.equal(typeof service.validateSessionSecurity, "function");
  assert.equal(typeof service.createFreshSessionBinding, "function");
  await service.waitForFreshSession("user", { now: () => time, sleep: async (ms) => { time += ms; } });
  assert.equal(records.get("user").revocationPending, false);
  assert.equal(records.get("user").revokedBefore, 200);
  assert.equal(time, 201000);
  assert.equal(revocations, 1);
  await service.waitForFreshSession("user", { now: () => time, sleep: async () => assert.fail("Recovered login must not wait again") });
  assert.equal(revocations, 1);
});

test("malformed and disposable email errors are exactly the required message", async () => {
  const service = registrationService();
  for (const email of ["fake", "fake@@gmail.com", ".fake@gmail.com", "fake@-domain.com", "fake@yopmail.com"]) {
    await assert.rejects(service.validateRegistrationSecurity({ ip: "1.2.3.4" }, email),
      { statusCode: 400, message: "Illegitimate email cannot be verified" });
  }
});

test("unknown email domains require mail records; DNS outages are not mislabeled as fake emails", async () => {
  for (const [records, code, statusCode] of [[[{ exchange: "mx.example.org" }], null, null],
    [[], null, 400], [[{ exchange: "." }], null, 400], [null, "ENOTFOUND", 400], [null, "ETIMEOUT", 503]]) {
    const service = loadService("registrationSecurity.service.js", {
      "../config/firebaseAdmin": { db: null },
      "../config/env": { env: { security: {} } },
      "node:dns/promises": { Resolver: class { async resolveMx() {
        if (code) throw Object.assign(new Error(code), { code });
        return records;
      } } },
    });
    if (statusCode) {
      await assert.rejects(service.assertEmailIsDeliverable("test@example.org"),
        statusCode === 400 ? { statusCode, message: "Illegitimate email cannot be verified" } : { statusCode });
    } else await service.assertEmailIsDeliverable("test@example.org");
  }
});

test("configured email providers cannot bypass mailbox validation for common domains", async () => {
  const service = loadService("registrationSecurity.service.js", {
    "../config/firebaseAdmin": { db: null },
    "../config/env": { env: { security: { emailValidationUrl: "https://example.org/check?email={email}" } } },
  }, { fetch: async () => response({ deliverable: false }) });
  await assert.rejects(service.assertEmailIsDeliverable("fake@gmail.com"),
    { statusCode: 400, message: "Illegitimate email cannot be verified" });
});

test("booking transaction enforces ownership and capacity before writing", async () => {
  let writes = 0;
  let full = false;
  const transaction = {
    get: async (ref) => ref.query
      ? { docs: full ? [{ data: () => ({ status: "Pending" }) }] : [] }
      : { exists: false },
    set: () => { writes++; },
  };
  const controller = loadService("../controllers/appointment.controller.js", {
    "../config/firebaseAdmin": { db: {
      collection: () => ({ doc: () => ({}), where: () => ({ query: true }) }),
      runTransaction: async (action) => action(transaction),
    } },
  });
  const req = {
    auth: { user: { uid: "user", role: "customer" } }, params: { id: "booking" },
    body: { id: "booking", customerId: "other", status: "Pending", slotId: "slot", slotCapacity: 1 },
  };
  await assert.rejects(controller.saveAppointment(req, { json() {} }), { statusCode: 403 });
  assert.equal(writes, 0);
  req.body.customerId = "user";
  full = true;
  await assert.rejects(controller.saveAppointment(req, { json() {} }), { statusCode: 409 });
  assert.equal(writes, 0);
  full = false;
  await controller.saveAppointment(req, { json() {} });
  assert.equal(writes, 1);
});
