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

test("Customer, Admin, and Staff sessions revoke after an IP switch", async () => {
  for (const role of ["customer", "admin", "staff"]) {
    const service = sessionService(async () => {});
    const req = { ip: "1.2.3.4", auth: { user: { uid: role, role },
      claims: { auth_time: 1 }, provider: "firebase-id-token" } };
    await service.validateSessionSecurity(req);
    req.ip = "8.8.8.8";
    await assert.rejects(service.validateSessionSecurity(req), (error) => error.details.reason === "ip-changed");
    assert.equal(service.refreshRevocations, 1);
  }
});

test("country mismatches never block access; changed IP uses a fresh lookup", async () => {
  const urls = [];
  const service = geoService(async (url) => {
    urls.push(url.href);
    return response({ country_code: urls.length === 1 ? "PH" : "US", security: { vpn: false, proxy: false } });
  });
  await service.validateAccessSecurity(request("1.2.3.4"));
  await service.validateAccessSecurity(request("1.2.3.4"));
  await service.validateAccessSecurity(request("8.8.8.8"));
  assert.deepEqual(urls, ["https://api.ipquery.io/1.2.3.4", "https://api.ipquery.io/8.8.8.8"]);
});

test("explicit VPN/proxy/Tor flags block regardless of fail-closed; generic risk does not", async () => {
  for (const field of ["vpn", "proxy", "tor"]) {
    for (const flag of [true, 1, "true", "1"]) {
      const service = geoService(async () => response({ country_code: "PH", security: { [field]: flag } }));
      await assert.rejects(service.validateAccessSecurity(request("1.2.3.4")), { statusCode: 403 });
    }
  }
  await geoService(async () => response({ country_code: "PH", security: { vpn: "false", proxy: false, hosting: true } }))
    .validateAccessSecurity(request("1.2.3.4"));
  for (const data of [{ country_code: "US", security: { anonymous: true, hosting: true } },
    { location: { country_code: "SG" }, risk: { risk_score: 100, is_datacenter: true, is_mobile: true } },
    { security: { vpn: "unknown", proxy: "likely" } }]) {
    const service = geoService(async () => response(data), true, "production");
    await service.validateAccessSecurity(request("1.2.3.4"));
    await service.validateRegistrationSecurity(request("1.2.3.4"), "test@gmail.com");
  }
});

test("outages, quotas, and missing detection data do not block login or registration", async () => {
  const results = [
    async () => { throw new Error("offline"); },
    async () => ({ ok: false, status: 429 }),
    async () => response({ success: false }),
    async () => response({}),
    async () => response({ country_code: "PH" }),
    async () => response({ success: false, security: { vpn: true } }),
    async () => response({ error: "invalid query", security: { vpn: true } }),
    async () => response({ ip: "8.8.8.8", risk: { is_vpn: true } }),
  ];
  for (const fetch of results) {
    for (const failClosed of [false, true]) {
      const service = geoService(fetch, failClosed, "production");
      await service.validateAccessSecurity(request("1.2.3.4"));
      await service.validateRegistrationSecurity(request("1.2.3.4"), "test@gmail.com");
    }
  }
});

test("local/private or unavailable IPs are not VPN evidence; client headers cannot bypass explicit flags", async () => {
  const service = geoService(async () => response({ country_code: "US", risk: { is_vpn: true } }));
  for (const ip of ["127.0.0.1", "::1", "fd00::1"]) await service.validateAccessSecurity(request(ip));
  await assert.rejects(service.validateAccessSecurity({ ip: "8.8.8.8", headers: { "cf-ipcountry": "PH" } }), { statusCode: 403 });
  await assert.rejects(service.validateRegistrationSecurity({ ip: "8.8.8.8", headers: { "cf-ipcountry": "PH" } }, "test@gmail.com"), { statusCode: 403 });
  const production = geoService(async () => assert.fail("Unavailable public IP must not reach provider"), false, "production");
  for (const ip of ["127.0.0.1", "10.0.0.1", "fd00::1", "unknown", "", "invalid-ip"]) {
    await production.validateAccessSecurity(request(ip));
    await production.validateRegistrationSecurity(request(ip), "test@gmail.com");
  }
});

test("explicit VPN detection on the same IP terminates the session", async () => {
  let vpn = false;
  const service = sessionService(async () => { if (vpn) throw new ApiError(403, "VPN detected"); });
  const req = { ip: "1.2.3.4", auth: { user: { uid: "user" }, claims: { auth_time: 1 }, provider: "firebase-id-token" } };
  await service.validateSessionSecurity(req);
  vpn = true;
  await assert.rejects(service.validateSessionSecurity(req), (error) => error.details.reason === "vpn-proxy");
  assert.equal(service.refreshRevocations, 1);
});

function sessionService(validateAccessSecurity, failRevocation = false, clock = Date) {
  const records = new Map();
  let refreshRevocations = 0;
  let queue = Promise.resolve();
  const db = {
    collection: (collection) => ({ doc: (uid) => ({ key: `${collection}/${uid}`,
      get: async () => ({ data: () => records.get(`${collection}/${uid}`) }) }) }),
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
    "../config/firebaseAdmin": { db, auth: { revokeRefreshTokens: async () => {
      refreshRevocations++;
      if (failRevocation) throw new Error("Firebase unavailable");
    } } },
    "./registrationSecurity.service": { getClientIp: (req) => req.ip, validateAccessSecurity },
  }, { Date: clock });
  return { ...service, records, get refreshRevocations() { return refreshRevocations; } };
}

test("fresh session IDs ignore stale server bindings across all roles and both token providers", async () => {
  for (const role of ["customer", "admin", "staff"]) {
    const service = sessionService(async () => {});
    const startedAt = Math.floor(Date.now() / 1000);
    service.records.set(`sessionSecurity/${role}`, { revokedBefore: startedAt - 1, reason: "vpn-proxy" });
    for (const provider of ["server-jwt", "firebase-id-token"]) {
      service.records.set(`sessionConnections/${role}-${provider}-${startedAt}`, { ip: "9.9.9.9" });
    }
    const sessionId = await service.createFreshSessionBinding(role, "1.2.3.4");
    for (const provider of ["server-jwt", "firebase-id-token"]) {
      const req = { ip: "1.2.3.4", auth: { user: { uid: role, role }, provider,
        claims: { iat: startedAt, auth_time: startedAt, sessionId, connectionIp: "1.2.3.4" } } };
      await service.validateSessionSecurity(req);
      await service.validateSessionSecurity(req);
    }
    assert.equal(service.records.get(`sessionConnections/${role}-${sessionId}`).ip, "1.2.3.4");
    assert.equal(service.records.get(`sessionSecurity/${role}`).revokedBefore, startedAt - 1);
    assert.equal(service.refreshRevocations, 0);
  }
});

test("fresh login IDs are distinct even with the same user and issuance timestamp", async () => {
  const service = sessionService(async () => {});
  const startedAt = Math.floor(Date.now() / 1000);
  const first = await service.createFreshSessionBinding("user", "1.2.3.4");
  const second = await service.createFreshSessionBinding("user", "5.6.7.8");
  assert.notEqual(first, second);
  for (const [sessionId, ip] of [[first, "1.2.3.4"], [second, "5.6.7.8"]]) {
    await service.validateSessionSecurity({ ip, auth: { user: { uid: "user" }, provider: "server-jwt",
      claims: { iat: startedAt, sessionId } } });
  }
});

test("VPN logout followed by fresh clean login replaces the binding without reviving revoked tokens", async () => {
  let time = 1000000;
  const clock = class extends Date { static now() { return time; } };
  const service = sessionService(async () => {}, false, clock);
  const oldId = await service.createFreshSessionBinding("user", "1.2.3.4");
  const req = { ip: "9.9.9.9", auth: { user: { uid: "user" }, provider: "server-jwt",
    claims: { iat: 1000, sessionId: oldId } } };
  await assert.rejects(service.validateSessionSecurity(req), (error) => error.details.reason === "ip-changed");
  time += 2000;
  const newId = await service.createFreshSessionBinding("user", "1.2.3.4");
  const fresh = { ip: "1.2.3.4", auth: { ...req.auth, claims: { iat: 1002, sessionId: newId } } };
  await service.validateSessionSecurity(fresh);
  await service.validateSessionSecurity(fresh);
  req.ip = "1.2.3.4";
  await assert.rejects(service.validateSessionSecurity(req), (error) => error.details.reason === "revoked");
  await service.validateSessionSecurity(fresh);
  assert.equal(service.refreshRevocations, 1);
  assert.equal(service.records.get(`sessionConnections/user-${oldId}`).ip, "1.2.3.4");
});

test("repeated VPN termination and clean recovery automatically adopt each new IP for all roles and token types", async () => {
  for (const role of ["customer", "admin", "staff"]) {
    for (const provider of ["server-jwt", "firebase-id-token"]) {
      let time = 1000000;
      let vpn = false;
      const clock = class extends Date { static now() { return time; } };
      const service = sessionService(async () => {
        if (vpn) throw new ApiError(403, "Blocked VPN IP address");
      }, false, clock);
      const terminated = [];
      const sessionIds = new Set();
      const networks = ["1.2.3.4", "5.6.7.8", "8.8.8.8", "1.2.3.4"];
      for (let cycle = 0; cycle < networks.length; cycle++) {
        const ip = networks[cycle];
        const sessionId = await service.createFreshSessionBinding(role, ip);
        assert.equal(sessionIds.has(sessionId), false);
        sessionIds.add(sessionId);
        const req = { ip, auth: { user: { uid: role, role }, provider,
          claims: { sessionId, connectionIp: ip, iat: time / 1000, auth_time: time / 1000 } } };
        assert.equal(service.records.get(`sessionConnections/${role}-${sessionId}`).ip, ip);
        for (const old of terminated) {
          await assert.rejects(service.validateSessionSecurity(old), (error) => error.details.reason === "revoked");
        }
        await service.validateSessionSecurity(req);
        await service.validateSessionSecurity(req);
        if (cycle === networks.length - 1) continue;
        // Exercise both explicit VPN detection on the same IP and a VPN-induced IP switch.
        if (cycle % 2 === 0) vpn = true;
        else req.ip = "9.9.9.9";
        await assert.rejects(service.validateSessionSecurity(req),
          (error) => error.details.reason === (vpn ? "vpn-proxy" : "ip-changed"));
        vpn = false;
        terminated.push(req);
        time += 2000;
      }
      assert.equal(sessionIds.size, networks.length);
      assert.equal(service.refreshRevocations, networks.length - 1);
      assert.equal(service.records.get(`sessionSecurity/${role}`).revocationPending, false);
    }
  }
});

test("missing or malformed new-session bindings cannot be silently rebound by dashboard requests", async () => {
  const service = sessionService(async () => assert.fail("Invalid binding must be rejected before lookup"));
  const req = { ip: "1.2.3.4", auth: { user: { uid: "user" }, provider: "server-jwt",
    claims: { iat: Math.floor(Date.now() / 1000), sessionId: "../../other-user" } } };
  await assert.rejects(service.validateSessionSecurity(req), (error) => error.details.reason === "invalid-session");
  req.auth.claims.sessionId = require("node:crypto").randomUUID();
  await assert.rejects(service.validateSessionSecurity(req), (error) => error.details.reason === "revoked");
  assert.equal(service.records.size, 0);
  assert.equal(service.refreshRevocations, 0);
});

test("fresh login lookups bypass a cached VPN result after returning to the normal network", async () => {
  let vpn = true;
  let calls = 0;
  const geo = geoService(async () => { calls++; return response({ risk: { is_vpn: vpn } }); });
  await assert.rejects(geo.validateAccessSecurity(request("1.2.3.4")),
    { statusCode: 403, message: "Blocked VPN IP address. Disable your VPN or proxy and try again." });
  vpn = false;
  await geo.validateAccessSecurity(request("1.2.3.4"), { fresh: true });
  assert.equal(calls, 2);
});

test("same-second clean recovery waits past the old cutoff for every role without clearing revocation", async () => {
  for (const role of ["customer", "admin", "staff"]) {
    let time = 100250;
    const service = sessionService(async () => {});
    service.records.set(`sessionSecurity/${role}`, { revokedBefore: 100, revocationPending: true });
    const delays = [];
    await service.waitForFreshSession(role, { now: () => time, sleep: async (ms) => {
      delays.push(ms);
      time += ms;
      service.records.get(`sessionSecurity/${role}`).revocationPending = false;
    } });
    assert.deepEqual(delays, [100, 650]);
    const req = { ip: "1.2.3.4", auth: { user: { uid: role, role }, claims: { auth_time: time / 1000 }, provider: "firebase-id-token" } };
    await service.validateSessionSecurity(req);
    await service.validateSessionSecurity(req);
    assert.equal(service.records.get(`sessionSecurity/${role}`).revokedBefore, 100);
    assert.equal(service.refreshRevocations, 0);
  }
});

test("stuck pending revocation is repaired for a verified fresh login without reviving old tokens", async () => {
  let time = 200250;
  const service = sessionService(async () => {});
  service.records.set("sessionSecurity/user", { revokedBefore: 100, revocationPending: true });
  await service.waitForFreshSession("user", { now: () => time, sleep: async (ms) => { time += ms; } });
  assert.equal(service.records.get("sessionSecurity/user").revocationPending, false);
  assert.equal(service.records.get("sessionSecurity/user").revokedBefore, 200);
  assert.equal(service.refreshRevocations, 1);
  const req = { ip: "1.2.3.4", auth: { user: { uid: "user" }, claims: { iat: 100 }, provider: "server-jwt" } };
  await assert.rejects(service.validateSessionSecurity(req), (error) => error.details.reason === "revoked");
  req.auth.claims.iat = Math.floor(time / 1000);
  await service.validateSessionSecurity(req);
  await service.validateSessionSecurity(req);
});

test("late VPN lookup from an already revoked session cannot penalize a fresh clean session", async () => {
  let time = 200000;
  class Clock extends Date { static now() { return time; } }
  let release;
  let ready;
  const waiting = new Promise((resolve) => { ready = resolve; });
  let checks = 0;
  const service = sessionService(async () => {
    if (++checks === 1) { ready(); await new Promise((resolve) => { release = resolve; }); throw new ApiError(403, "VPN"); }
  }, false, Clock);
  const oldAuth = { user: { uid: "user" }, claims: { iat: 100, connectionIp: "1.2.3.4" }, provider: "server-jwt" };
  const pending = assert.rejects(service.validateSessionSecurity({ ip: "1.2.3.4", auth: oldAuth }),
    (error) => error.details.reason === "revoked");
  await waiting;
  await assert.rejects(service.validateSessionSecurity({ ip: "8.8.8.8", auth: oldAuth }),
    (error) => error.details.reason === "ip-changed");
  const fresh = { ip: "1.2.3.4", auth: { ...oldAuth, claims: { iat: 201, connectionIp: "1.2.3.4" } } };
  await service.validateSessionSecurity(fresh);
  time = 205000;
  release();
  await pending;
  assert.equal(service.records.get("sessionSecurity/user").revokedBefore, 200);
  assert.equal(service.refreshRevocations, 1);
  await service.validateSessionSecurity(fresh);
});

test("persisted revocation blocks restored IPs and refreshed tokens; fresh logins work", async () => {
  let checks = 0;
  const service = sessionService(async () => {
      checks++;
  });
  const req = { ip: "1.2.3.4", auth: { user: { uid: "user" }, claims: { auth_time: 1, iat: 1 }, provider: "firebase-id-token" } };
  const isViolation = (error) => error.statusCode === 401 && error.details.code === "SESSION_SECURITY_VIOLATION";
  service.records.set("sessionSecurity/user", { revokedBefore: 100, reason: "revoked" });
  await assert.rejects(service.validateSessionSecurity(req), isViolation);
  const revokedBefore = service.records.get("sessionSecurity/user").revokedBefore;
  req.auth.claims.iat = revokedBefore + 10;
  await assert.rejects(service.validateSessionSecurity(req), isViolation);
  req.auth.provider = "server-jwt";
  req.auth.claims.iat = 1;
  await assert.rejects(service.validateSessionSecurity(req), isViolation);
  req.auth.claims.iat = revokedBefore + 1;
  await service.validateSessionSecurity(req);
  assert.equal(checks, 1);
  assert.equal(service.refreshRevocations, 0);
});

test("provider unavailability does not revoke active sessions or refresh tokens", async () => {
  const geo = geoService(async () => { throw new Error("Unavailable"); });
  const service = sessionService(geo.validateAccessSecurity);
  await service.validateSessionSecurity({ ip: "1.2.3.4",
    auth: { user: { uid: "user" }, claims: { iat: 1 }, provider: "server-jwt" } });
  assert.equal(service.records.has("sessionSecurity/user"), false);
  assert.equal(service.refreshRevocations, 0);
});

test("all roles stay active for ambiguous data, but explicit VPN flags revoke", async () => {
  for (const role of ["customer", "admin", "staff"]) {
    for (const data of [{ country_code: "US" }, { risk: { risk_score: 100, anonymous: true } }, null]) {
      const geo = geoService(async () => response(data), true, "production");
      const service = sessionService(geo.validateAccessSecurity);
      await service.validateSessionSecurity({ ip: "1.2.3.4", auth: { user: { uid: role, role },
        claims: { auth_time: 1 }, provider: "firebase-id-token" } });
      assert.equal(service.records.has(`sessionSecurity/${role}`), false);
      assert.equal(service.refreshRevocations, 0);
    }
    const geo = geoService(async () => response({ ip: "1.2.3.4", risk: { is_vpn: true } }));
    const service = sessionService(geo.validateAccessSecurity);
    await assert.rejects(service.validateSessionSecurity({ ip: "1.2.3.4", auth: { user: { uid: role, role },
      claims: { auth_time: 1 }, provider: "firebase-id-token" } }), (error) => error.details.reason === "vpn-proxy");
    assert.equal(service.refreshRevocations, 1);
  }
});

test("IP switches revoke before provider lookup and returning to the old IP cannot revive the token", async () => {
  let checks = 0;
  const service = sessionService(async () => { checks++; });
  const req = { ip: "1.2.3.4", auth: { user: { uid: "user" }, claims: { auth_time: 1 }, provider: "firebase-id-token" } };
  await service.validateSessionSecurity(req);
  req.ip = "8.8.8.8";
  await assert.rejects(service.validateSessionSecurity(req), (error) => error.details.reason === "ip-changed");
  assert.equal(checks, 1);
  req.ip = "1.2.3.4";
  await assert.rejects(service.validateSessionSecurity(req), (error) => error.details.reason === "revoked");
  assert.equal(service.refreshRevocations, 1);
});

test("signed login IP claims block a switch before the first poll", async () => {
  const service = sessionService(async () => assert.fail("Changed IP must be rejected before provider lookup"));
  await assert.rejects(service.validateSessionSecurity({ ip: "8.8.8.8", auth: { user: { uid: "user" },
    claims: { iat: 1, connectionIp: "1.2.3.4" }, provider: "server-jwt" } }), (error) => error.details.reason === "ip-changed");
});

test("persisted revocation blocks replay even when Firebase refresh-token revocation fails", async () => {
  const service = sessionService(async () => {}, true);
  const req = { ip: "8.8.8.8", auth: { user: { uid: "user" },
    claims: { iat: 1, connectionIp: "1.2.3.4" }, provider: "server-jwt" } };
  await assert.rejects(service.validateSessionSecurity(req), (error) => error.details.reason === "ip-changed");
  req.ip = "1.2.3.4";
  await assert.rejects(service.validateSessionSecurity(req), (error) => error.details.reason === "revoked");
  assert.equal(service.refreshRevocations, 1);
});

test("an in-flight lookup cannot authorize a session revoked by another request", async () => {
  let release;
  let ready;
  const waiting = new Promise((resolve) => { ready = resolve; });
  const service = sessionService(async () => {
    ready();
    await new Promise((resolve) => { release = resolve; });
  });
  const auth = { user: { uid: "user" }, claims: { iat: 1, connectionIp: "1.2.3.4" }, provider: "server-jwt" };
  const first = assert.rejects(service.validateSessionSecurity({ ip: "1.2.3.4", auth }),
    (error) => error.details.reason === "revoked");
  await waiting;
  await assert.rejects(service.validateSessionSecurity({ ip: "8.8.8.8", auth }),
    (error) => error.details.reason === "ip-changed");
  release();
  await first;
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
