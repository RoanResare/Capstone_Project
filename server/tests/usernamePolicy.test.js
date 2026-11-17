const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");

function loadUserService({ username = "legacy name", usernameOwners = {} } = {}) {
  const profile = {
    uid: "employee", authUserId: "employee", email: "employee@example.com", fullName: "Employee",
    username, role: "staff", accountStatus: "active", status: "active", fraudStatus: "normal", phone: "",
  };
  const writes = [];
  let authUpdates = 0;
  const snapshot = value => ({ exists: Boolean(value), data: () => value });
  const db = {
    collection(name) {
      return {
        doc(id) {
          return {
            collection: name, id,
            get: async () => snapshot(name === "users" && id === "employee" ? profile : usernameOwners[id]),
          };
        },
        where(field, _operator, value) {
          return { limit() { return { get: async () => ({ empty: true, docs: [] }) }; } };
        },
      };
    },
    async runTransaction(callback) {
      await callback({
        get: async reference => snapshot(reference.collection === "usernames" ? usernameOwners[reference.id] : null),
        set: (reference, data, options) => writes.push({ operation: "set", reference, data, options }),
        delete: reference => writes.push({ operation: "delete", reference }),
      });
    },
  };
  const filename = path.resolve(__dirname, "../src/services/user.service.js");
  const service = new Module(filename, module);
  service.filename = filename;
  service.paths = module.paths;
  const realRequire = service.require.bind(service);
  service.require = id => {
    if (id === "../config/postgresDatabase") return { db };
    if (id === "../config/env") return { env: { nodeEnv: "test", runtime: { supabaseAdminReady: false } } };
    if (id === "./supabaseAuth.service") return {
      findSupabaseUserByEmail: async () => null,
      getSupabaseUserById: async () => ({ id: "employee", email: "employee@example.com" }),
      updateSupabaseUser: async () => { authUpdates++; },
    };
    if (id === "./registrationSecurity.service") return {
      assertEmailIsDeliverable: async () => {}, assertRegistrationEmailAllowed() {},
    };
    return realRequire(id);
  };
  service._compile(fs.readFileSync(filename, "utf8"), filename);
  return { service: service.exports, writes, get authUpdates() { return authUpdates; } };
}

test("saving unrelated employee details preserves an unchanged legacy username", async () => {
  const fixture = loadUserService();
  const saved = await fixture.service.updatePortalUser("employee", {
    fullName: "Updated Employee", email: "employee@example.com", username: "legacy name", role: "staff",
  });
  assert.equal(saved.username, "legacy name");
  const profileWrite = fixture.writes.find(write => write.reference.collection === "users");
  assert.equal(profileWrite.data.fullName, "Updated Employee");
  assert.equal(Object.hasOwn(profileWrite.data, "username"), false);
  assert.equal(fixture.writes.some(write => write.reference.collection === "usernames"), false);
  assert.equal(fixture.authUpdates, 1);
});

test("employee username changes use shared validation and preserve case-insensitive uniqueness", async () => {
  const valid = loadUserService();
  const saved = await valid.service.updatePortalUser("employee", {
    fullName: "Employee", email: "employee@example.com", username: "New.Name2", role: "staff",
  });
  assert.equal(saved.username, "new.name2");
  assert.ok(valid.writes.some(write => write.reference.collection === "usernames" && write.reference.id === "new.name2"));

  const duplicate = loadUserService({ usernameOwners: { "taken.name": { uid: "another-user" } } });
  await assert.rejects(duplicate.service.updatePortalUser("employee", {
    fullName: "Employee", email: "employee@example.com", username: "Taken.Name", role: "staff",
  }), error => error.statusCode === 409);
  assert.equal(duplicate.authUpdates, 0);
});

test("employee username changes reject invalid characters and lengths", async () => {
  for (const username of ["ab", "a".repeat(25), "bad name", "bad/name"]) {
    const fixture = loadUserService();
    await assert.rejects(fixture.service.updatePortalUser("employee", {
      fullName: "Employee", email: "employee@example.com", username, role: "staff",
    }), /Username must/);
    assert.equal(fixture.authUpdates, 0, username);
  }
});
