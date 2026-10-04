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
    console: { warn() {} }, ...globals,
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "../src/services", filename), "utf8"), context);
  return context.module.exports;
}

function geoService(fetch, failClosed = false, nodeEnv = "development") {
  return loadService("registrationSecurity.service.js", {
    "../config/firebaseAdmin": { db: null },
    "../config/env": { env: { nodeEnv, security: { failClosed } } },
  }, { fetch });
}

const request = (ip) => ({ ip, headers: {} });
const response = (data) => ({ ok: true, json: async () => data });

test("default no-key provider authorizes normal production login and registration", async () => {
  const service = geoService(async (url) => {
    assert.equal(url.href, "https://api.ipquery.io/1.2.3.4");
    return response({ location: { country_code: "PH" }, risk: { is_vpn: false, is_proxy: false, is_tor: false } });
  }, false, "production");
  await service.validateAccessSecurity(request("1.2.3.4"));
  await service.validateRegistrationSecurity(request("1.2.3.4"), "customer@gmail.com");
});

test("default provider VPN, proxy, and Tor results reject both login and registration", async () => {
  for (const field of ["is_vpn", "is_proxy", "is_tor"]) {
    const service = geoService(async () => response({ location: { country_code: "PH" },
      risk: { is_vpn: false, is_proxy: false, is_tor: false, [field]: true } }), false, "production");
    await assert.rejects(service.validateAccessSecurity(request("1.2.3.4")), { statusCode: 403 });
    await assert.rejects(service.validateRegistrationSecurity(request("1.2.3.4"), "test@gmail.com"), { statusCode: 403 });
  }
});

test("malformed and disposable email errors are exactly the required message", async () => {
  const service = geoService(async () => assert.fail("Invalid email must not reach IP lookup"));
  for (const email of ["fake", "fake@@gmail.com", ".fake@gmail.com", "fake@-domain.com", "fake@yopmail.com"]) {
    await assert.rejects(service.validateRegistrationSecurity(request("1.2.3.4"), email),
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

test("Customer, Admin, and Staff sessions all revoke immediately on an observed IP switch", async () => {
  for (const role of ["customer", "admin", "staff"]) {
    const service = sessionService(async () => {});
    const req = { ip: "1.2.3.4", auth: { user: { uid: role, role },
      claims: { auth_time: 1 }, provider: "firebase-id-token" } };
    await service.validateSessionSecurity(req);
    req.ip = "8.8.8.8";
    await assert.rejects(service.validateSessionSecurity(req),
      (error) => error.details.code === "SESSION_SECURITY_VIOLATION" && error.details.reason === "ip-changed");
    assert.equal(service.refreshRevocations, 1);
  }
});

test("foreign locations block with fail-open enabled; changed IP bypasses cached checks", async () => {
  const urls = [];
  const service = geoService(async (url) => {
    urls.push(url.href);
    return response({ country_code: urls.length === 1 ? "PH" : "US", security: { vpn: false, proxy: false } });
  });
  await service.validateAccessSecurity(request("1.2.3.4"));
  await service.validateAccessSecurity(request("1.2.3.4"));
  await assert.rejects(service.validateAccessSecurity(request("8.8.8.8")), { statusCode: 403 });
  assert.deepEqual(urls, ["https://api.ipquery.io/1.2.3.4", "https://api.ipquery.io/8.8.8.8"]);
});

test("VPN flags block PH connections; false strings and hosting alone do not", async () => {
  for (const field of ["vpn", "proxy", "tor", "anonymous"]) {
    for (const flag of [true, 1, "true", "1"]) {
      const service = geoService(async () => response({ country_code: "PH", security: { [field]: flag } }));
      await assert.rejects(service.validateAccessSecurity(request("1.2.3.4")), { statusCode: 403 });
    }
  }
  await geoService(async () => response({ country_code: "PH", security: { vpn: "false", proxy: false, hosting: true } }))
    .validateAccessSecurity(request("1.2.3.4"));
});

test("outages, quotas, and missing VPN/proxy flags reject access even with fail-open configured", async () => {
  const results = [
    async () => { throw new Error("offline"); },
    async () => ({ ok: false, status: 429 }),
    async () => response({ success: false }),
    async () => response({}),
    async () => response({ country_code: "PH" }),
  ];
  for (const fetch of results) await assert.rejects(geoService(fetch).validateAccessSecurity(request("1.2.3.4")), { statusCode: 503 });
  await assert.rejects(geoService(results[0], true).validateAccessSecurity(request("1.2.3.4")), { statusCode: 503 });
});

test("local development bypasses lookup; client country headers cannot override it", async () => {
  const service = geoService(async () => response({ country_code: "US" }));
  for (const ip of ["127.0.0.1", "::1", "fd00::1"]) await service.validateAccessSecurity(request(ip));
  await assert.rejects(service.validateAccessSecurity({ ip: "8.8.8.8", headers: { "cf-ipcountry": "PH" } }), { statusCode: 403 });
  await assert.rejects(service.validateRegistrationSecurity({ ip: "8.8.8.8", headers: { "cf-ipcountry": "PH" } }, "test@gmail.com"), { statusCode: 403 });
  await assert.rejects(geoService(async () => assert.fail("Private IP must not reach provider"), false, "production")
    .validateAccessSecurity(request("127.0.0.1")), { statusCode: 503 });
});

test("VPN activation on an unchanged IP still revokes the authenticated session", async () => {
  let vpn = false;
  const service = sessionService(async () => { if (vpn) throw new ApiError(403, "VPN detected"); });
  const req = { ip: "1.2.3.4", auth: { user: { uid: "user" }, claims: { auth_time: 1 }, provider: "firebase-id-token" } };
  await service.validateSessionSecurity(req);
  vpn = true;
  await assert.rejects(service.validateSessionSecurity(req), (error) => error.details.reason === "vpn-proxy");
  assert.equal(service.refreshRevocations, 1);
});

function sessionService(validateAccessSecurity) {
  const records = new Map();
  let refreshRevocations = 0;
  let queue = Promise.resolve();
  const db = {
    collection: (collection) => ({ doc: (uid) => ({ key: `${collection}/${uid}` }) }),
    runTransaction(action) {
      const operation = queue.then(() => action({
        get: async (reference) => ({ exists: records.has(reference.key), data: () => records.get(reference.key) }),
        set: (reference, value) => records.set(reference.key, { ...records.get(reference.key), ...value }),
      }));
      queue = operation.catch(() => {});
      return operation;
    },
  };
  const service = loadService("sessionSecurity.service.js", {
    "../config/firebaseAdmin": { db, auth: { revokeRefreshTokens: async () => { refreshRevocations++; } } },
    "./registrationSecurity.service": { getClientIp: (req) => req.ip, validateAccessSecurity },
  });
  return { ...service, records, get refreshRevocations() { return refreshRevocations; } };
}

test("persisted revocation blocks restored IPs and refreshed tokens; fresh logins work", async () => {
  let checks = 0;
  const service = sessionService(async () => {
      checks++;
      if (checks === 1) throw new ApiError(403, "VPN");
  });
  const req = { ip: "1.2.3.4", auth: { user: { uid: "user" }, claims: { auth_time: 1, iat: 1 }, provider: "firebase-id-token" } };
  const isViolation = (error) => error.statusCode === 401 && error.details.code === "SESSION_SECURITY_VIOLATION";
  await assert.rejects(service.validateSessionSecurity(req), isViolation);
  const revokedBefore = service.records.get("sessionSecurity/user").revokedBefore;
  req.auth.claims.iat = revokedBefore + 10;
  await assert.rejects(service.validateSessionSecurity(req), isViolation);
  req.auth.provider = "server-jwt";
  req.auth.claims.iat = 1;
  await assert.rejects(service.validateSessionSecurity(req), isViolation);
  req.auth.claims.iat = revokedBefore + 1;
  await service.validateSessionSecurity(req);
  assert.equal(checks, 2);
  assert.equal(service.refreshRevocations, 1);
});

test("unverifiable active connections revoke the session instead of silently allowing access", async () => {
  const service = sessionService(async () => { throw new ApiError(503, "Unavailable"); });
  await assert.rejects(service.validateSessionSecurity({ ip: "1.2.3.4",
    auth: { user: { uid: "user" }, claims: { iat: 1 }, provider: "server-jwt" } }),
    (error) => error.statusCode === 401 && error.details.reason === "unverified");
  assert.equal(service.records.get("sessionSecurity/user").reason, "unverified");
  assert.equal(service.refreshRevocations, 1);
});

test("any IP switch revokes the session before geo lookup, including another clean Philippine IP", async () => {
  let checks = 0;
  const service = sessionService(async () => { checks++; });
  const req = { ip: "1.2.3.4", auth: { user: { uid: "user" }, claims: { auth_time: 1 }, provider: "firebase-id-token" } };
  await service.validateSessionSecurity(req);
  req.ip = "8.8.8.8";
  await assert.rejects(service.validateSessionSecurity(req), (error) => error.details.reason === "ip-changed");
  assert.equal(checks, 1);
  req.ip = "1.2.3.4";
  await assert.rejects(service.validateSessionSecurity(req), { statusCode: 401 });
  assert.equal(service.refreshRevocations, 1);
});

test("signed login IP claims reject a switch before the first heartbeat", async () => {
  const service = sessionService(async () => assert.fail("Changed IP must be rejected before provider lookup"));
  await assert.rejects(service.validateSessionSecurity({ ip: "8.8.8.8", auth: { user: { uid: "user" },
    claims: { iat: 1, connectionIp: "1.2.3.4" }, provider: "server-jwt" } }),
    (error) => error.details.reason === "ip-changed");
});

test("both token middlewares stop the request before an action on security violation", async () => {
  const violation = new ApiError(401, "Session terminated", { code: "SESSION_SECURITY_VIOLATION" });
  const claims = { sub: "user", role: "customer", email: "user@gmail.com", accountStatus: "active" };
  const middleware = loadService("../middlewares/authenticate.js", {
    "../config/firebaseAdmin": { auth: {} },
    "../config/env": { env: { auth: { jwtSecret: "test" } } },
    "../services/token.service": { verifyAccessToken: () => claims },
    "../services/user.service": {
      getUserByUid: async () => ({ uid: "user", ...claims }), toPublicUser: (user) => user,
    },
    "../constants/auth": { USER_STATUSES: { ACTIVE: "active" }, FRAUD_STATUSES: { SUSPENDED: "suspended", BANNED: "banned" } },
    "../services/sessionSecurity.service": { validateSessionSecurity: async () => { throw violation; } },
  });
  for (const verify of [middleware.verifyToken, middleware.verifySessionToken]) {
    let actionReached = false;
    let receivedError;
    await verify({ headers: { authorization: "Bearer test" } }, {}, (error) => {
      receivedError = error;
      if (!error) actionReached = true;
    });
    assert.equal(actionReached, false);
    assert.equal(receivedError, violation);
  }
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
