const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const express = require("express");

function load(relative, dependencies) {
  const filename = path.resolve(__dirname, relative);
  const module = new Module(filename);
  module.filename = filename;
  module.paths = Module._nodeModulePaths(path.dirname(filename));
  const originalRequire = module.require.bind(module);
  module.require = name => name in dependencies ? dependencies[name] : originalRequire(name);
  module._compile(fs.readFileSync(filename, "utf8"), filename);
  return module.exports;
}

async function fixture() {
  const records = new Map();
  const profiles = new Map(["admin", "staff", "customer", "inactive"].map(role => [role, {
    uid: role, role: role === "inactive" ? "admin" : role, email: `${role}@example.com`,
    accountStatus: role === "inactive" ? "inactive" : "active", fraudStatus: "normal",
  }]));
  const db = { collection: name => ({ doc: id => ({ key: `${name}/${id}` }) }),
    async runTransaction(action) {
      const pending = [];
      const result = await action({
        get: async ref => ({ exists: records.has(ref.key), data: () => records.get(ref.key) }),
        set: (ref, value, options) => pending.push([ref.key, options?.merge ? { ...records.get(ref.key), ...value } : value]),
      });
      for (const [key, value] of pending) records.set(key, value);
      return result;
    },
  };
  const env = { auth: { jwtSecret: "isolated-kapon-test-secret", jwtExpiresIn: "1h" } };
  const tokens = load("../src/services/token.service.js", { "../config/env": { env } });
  const authentication = load("../src/middlewares/authenticate.js", {
    "../config/env": { env }, "../services/token.service": tokens,
    "../services/user.service": { getUserByUid: async uid => profiles.get(uid), getUserByAuthId: async uid => profiles.get(uid), toPublicUser: user => user },
    "../services/sessionSecurity.service": { validateSessionSecurity: async () => {} },
    "../services/supabaseAuth.service": { isSupabaseAccessToken: () => false },
  });
  const promo = load("../src/controllers/promo.controller.js", { "../config/postgresDatabase": { db } });
  const unused = new Proxy({}, { get: () => (_req, res) => res.sendStatus(501) });
  const routes = load("../src/routes/auth.routes.js", {
    "../controllers/auth.controller": unused,
    "../middlewares/authenticate": authentication,
    "../middlewares/authRateLimiter": { authRateLimiter: (_req, _res, next) => next() },
    "../controllers/appointment.controller": unused, "../controllers/pet.controller": unused,
    "../controllers/promo.controller": promo, "../controllers/schedule.controller": unused,
    "../services/scheduleRecords.service": { listRecords: () => {} },
    "../controllers/registration.controller": unused, "../controllers/pricelist.controller": unused,
  });
  const app = express(); app.use(express.json()); app.use("/api/auth", routes);
  app.use((error, _req, res, _next) => res.status(error.statusCode || 500).json({ message: error.message }));
  const server = app.listen(0, "127.0.0.1");
  await new Promise(resolve => server.once("listening", resolve));
  const request = async (role, body) => {
    const user = profiles.get(role);
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/auth/promotions/low-cost-kapon`, {
      method: "PUT", headers: { "Content-Type": "application/json", ...(user ? { Authorization: `Bearer ${tokens.signAccessToken(user)}` } : {}) },
      body: JSON.stringify(body),
    });
    return { status: response.status, body: await response.json() };
  };
  return { records, request, close: () => new Promise(resolve => server.close(resolve)) };
}
const configuration = { title: "Low-Cost Kapon", description: "Clinic promotion", formLink: "https://forms.gle/test123" };

for (const role of ["admin", "staff"]) {
  test(`${role} credentials activate, edit and deactivate the promo through the protected route`, async () => {
    const app = await fixture();
    try {
      const activated = await app.request(role, { ...configuration, action: "activate", expectedRevision: 0 });
      assert.equal(activated.status, 200); assert.equal(activated.body.promo.isActive, true);
      assert.equal(app.records.get("lowCostKaponPromo/low-cost-kapon").isActive, true);
      assert.equal(app.records.get("promotionDetails/low-cost-kapon").activatedBy.role, role);
      const conflict = await app.request(role, { ...configuration, action: "edit", expectedRevision: 0 });
      assert.equal(conflict.status, 409);
      assert.equal(app.records.get("lowCostKaponPromo/low-cost-kapon").revision, 1);
      const edited = await app.request(role, { ...configuration, formLink: "https://forms.gle/updated123", action: "edit", expectedRevision: 1 });
      assert.equal(edited.status, 200);
      assert.equal(app.records.get("lowCostKaponPromo/low-cost-kapon").formLink, "https://forms.gle/updated123");
      const deactivated = await app.request(role, { action: "deactivate", expectedRevision: 2 });
      assert.equal(deactivated.status, 200);
      assert.equal(app.records.get("lowCostKaponPromo/low-cost-kapon").isActive, false);
      assert.equal(app.records.get("lowCostKaponPromo/low-cost-kapon").revision, 3);
    } finally { await app.close(); }
  });
}

test("customer, inactive and missing credentials cannot manage promotions or write records", async () => {
  const app = await fixture();
  try {
    for (const [role, expectedStatus] of [["customer", 403], ["inactive", 403], ["anonymous", 401]]) {
      const result = await app.request(role, { ...configuration, action: "activate", expectedRevision: 0 });
      assert.equal(result.status, expectedStatus);
      assert.equal(app.records.size, 0);
    }
  } finally { await app.close(); }
});
