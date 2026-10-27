const { test } = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const vm = require("node:vm");

function fixture() {
  const writes = [];
  const services = {
    createPortalUser: async data => { writes.push(data); return data; },
    updatePortalUser: async (uid, data) => { writes.push({ uid, ...data }); return data; },
    ensureAdminCanMutateTarget: async actor => assert.equal(actor.role, "admin"),
    toPublicUser: user => user,
    getUserByUid: async () => { throw new Error("Unexpected holder password check"); },
  };
  const modules = {
    "../services/authAttempts.service": {},
    "../constants/auth": require("../src/constants/auth"),
    "../config/env": { env: { nodeEnv: "production" } },
    "../services/user.service": services,
    "../utils/ApiError": require("../src/utils/ApiError"),
    "../utils/password": require("../src/utils/password"),
    "../utils/setupGuard": { assertAuthSetupReady() {} },
  };
  const context = { module: { exports: {} }, require: name => {
    assert.ok(name in modules, name); return modules[name];
  } };
  vm.runInNewContext(readFileSync(require.resolve("../src/controllers/user.controller"), "utf8"), context);
  const req = { auth: { user: { uid: "admin", role: "admin" } }, params: { uid: "employee" },
    body: { fullName: "Employee", email: "employee@example.com", username: "employee", role: "staff" } };
  const res = { status() { return this; }, json(data) { return data; } };
  return { controller: context.module.exports, req, res, writes };
}

test("employee creation and edits do not require the administrator's current password", async () => {
  const { controller, req, res, writes } = fixture();
  req.body.password = "Employee123!";
  await controller.createUser(req, res);
  assert.equal(writes.length, 1);
  assert.equal(writes[0].accountStatus, "active");
  delete req.body.password;
  await controller.updateUser(req, res);
  assert.equal(writes.length, 2);
  assert.equal(writes[1].password, undefined);
  req.body.password = "Replacement123!";
  await controller.updateUser(req, res);
  assert.equal(writes[2].password, "Replacement123!");
});

test("new employee password validation and separate destructive confirmations remain enforced", async () => {
  const { controller, req, res, writes } = fixture();
  await assert.rejects(controller.createUser(req, res), /required/);
  req.body.password = "weak";
  await assert.rejects(controller.createUser(req, res));
  await assert.rejects(controller.updateUser(req, res));
  delete req.body.password;
  req.body.status = "inactive";
  await assert.rejects(controller.updateUser(req, res), /current password/);
  await assert.rejects(controller.removeUser(req, res), /current password/);
  assert.equal(writes.length, 0);
});

test("ordinary frontend employee edits reach the backend without a status-confirmation password", async () => {
  const { controller, req, res, writes } = fixture();
  const source = readFileSync(require.resolve("../../src/app/context/AppContext.jsx"), "utf8");
  const method = source.slice(source.indexOf("    async updateUser(id, updates) {"), source.indexOf("    async deleteUser(id, currentPassword) {"));
  const employee = { id: "employee", name: "Employee", email: "employee@example.com", username: "employee", role: "staff", status: "active" };
  const context = {
    Error,
    currentUser: { id: "admin", role: "admin" }, accessToken: "authenticated-token",
    state: { users: [employee] }, normalizeEmail: value => value.toLowerCase(),
    normalizeUsername: value => value, normalizePortalRole: value => value,
    normalizePortalStatus: value => value, isValidUsername: () => true,
    isStrongPassword: () => true, dispatch() {}, invalidatePortalUsersCache() {},
    userApi: { updateUser: async (_token, id, payload) => {
      req.params.uid = id;
      req.body = JSON.parse(JSON.stringify(payload));
      return controller.updateUser(req, res);
    } },
  };
  vm.createContext(context);
  vm.runInContext(`globalThis.save = ({${method}}).updateUser;`, context);
  assert.equal((await context.save("employee", { password: "Updated123!" })).ok, true);
  assert.equal(writes[0].password, "Updated123!");
  assert.equal(req.body.status, undefined);
  assert.equal(writes[0].accountStatus, undefined);
  const statusChange = await context.save("employee", { status: "inactive" });
  assert.equal(statusChange.ok, false);
  assert.match(statusChange.error, /current password/);
  assert.equal(writes.length, 1);
});
