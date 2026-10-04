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
      if (!(name in dependencies)) throw new Error(`Unexpected dependency: ${name}`);
      return dependencies[name];
    },
    URL, AbortController, setTimeout, clearTimeout,
    console: { warn() {} }, ...globals,
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "../src/services", filename), "utf8"), context);
  return context.module.exports;
}

function geoService(fetch, failClosed = false) {
  return loadService("registrationSecurity.service.js", {
    "../config/firebaseAdmin": { db: null },
    "../config/env": { env: { security: { failClosed } } },
  }, { fetch });
}

const request = (ip) => ({ ip, headers: {} });
const response = (data) => ({ ok: true, json: async () => data });

test("foreign locations block with fail-open enabled; changed IP bypasses cached checks", async () => {
  const urls = [];
  const service = geoService(async (url) => {
    urls.push(url.href);
    return response({ country_code: urls.length === 1 ? "PH" : "US" });
  });
  await service.validateAccessSecurity(request("1.2.3.4"));
  await service.validateAccessSecurity(request("1.2.3.4"));
  await assert.rejects(service.validateAccessSecurity(request("8.8.8.8")), { statusCode: 403 });
  assert.deepEqual(urls, ["https://ipwho.is/1.2.3.4", "https://ipwho.is/8.8.8.8"]);
});

test("VPN flags block PH connections; false strings and hosting alone do not", async () => {
  for (const flag of [true, 1, "true"]) {
    const service = geoService(async () => response({ country_code: "PH", security: { vpn: flag } }));
    await assert.rejects(service.validateAccessSecurity(request("1.2.3.4")), { statusCode: 403 });
  }
  await geoService(async () => response({ country_code: "PH", security: { vpn: "false", hosting: true } }))
    .validateAccessSecurity(request("1.2.3.4"));
});

test("outages, quotas, and incomplete data allow usage by default", async () => {
  const results = [
    async () => { throw new Error("offline"); },
    async () => ({ ok: false, status: 429 }),
    async () => response({ success: false }),
    async () => response({}),
  ];
  for (const fetch of results) await geoService(fetch).validateAccessSecurity(request("1.2.3.4"));
  await assert.rejects(geoService(results[0], true).validateAccessSecurity(request("1.2.3.4")), { statusCode: 503 });
});

test("local development bypasses lookup; client country headers cannot override it", async () => {
  const service = geoService(async () => response({ country_code: "US" }));
  for (const ip of ["127.0.0.1", "::1", "fd00::1"]) await service.validateAccessSecurity(request(ip));
  await assert.rejects(service.validateAccessSecurity({ ip: "8.8.8.8", headers: { "cf-ipcountry": "PH" } }), { statusCode: 403 });
});

test("persisted revocation blocks restored IPs and refreshed tokens; fresh logins work", async () => {
  let revokedBefore;
  let checks = 0;
  const reference = {
    get: async () => ({ exists: revokedBefore !== undefined, data: () => ({ revokedBefore }) }),
    set: async (data) => { revokedBefore = data.revokedBefore; },
  };
  const service = loadService("sessionSecurity.service.js", {
    "../config/firebaseAdmin": { db: { collection: () => ({ doc: () => reference }) } },
    "./registrationSecurity.service": { validateAccessSecurity: async () => {
      checks++;
      if (checks === 1) throw new ApiError(403, "VPN");
    } },
  });
  const req = { auth: { user: { uid: "user" }, claims: { auth_time: 1, iat: 1 }, provider: "firebase-id-token" } };
  const isViolation = (error) => error.statusCode === 401 && error.details.code === "SESSION_SECURITY_VIOLATION";
  await assert.rejects(service.validateSessionSecurity(req), isViolation);
  req.auth.claims.iat = revokedBefore + 10;
  await assert.rejects(service.validateSessionSecurity(req), isViolation);
  req.auth.provider = "server-jwt";
  req.auth.claims.iat = 1;
  await assert.rejects(service.validateSessionSecurity(req), isViolation);
  req.auth.claims.iat = revokedBefore + 1;
  await service.validateSessionSecurity(req);
  assert.equal(checks, 2);
});

test("provider outages never persist a revocation", async () => {
  let writes = 0;
  const service = loadService("sessionSecurity.service.js", {
    "../config/firebaseAdmin": { db: { collection: () => ({ doc: () => ({
      get: async () => ({ exists: false }), set: async () => { writes++; },
    }) }) } },
    "./registrationSecurity.service": { validateAccessSecurity: async () => { throw new ApiError(503, "Unavailable"); } },
  });
  await assert.rejects(service.validateSessionSecurity({ auth: { user: { uid: "user" }, claims: {}, provider: "server-jwt" } }), { statusCode: 503 });
  assert.equal(writes, 0);
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
