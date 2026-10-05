const assert = require("node:assert/strict");
const { test } = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const { verifyRole } = require("../src/middlewares/authorize");
const vm = require("node:vm");
const { ApiError } = require("../src/utils/ApiError");

function controllerFixture() {
  const records = new Map();
  const context = {module: {exports: {}}, require(name) {
    if (name === "../utils/ApiError") return {ApiError};
    if (name === "../config/firebaseAdmin") return {db: {collection: () => ({
      doc: (id) => ({set: async (data) => records.set(id, {...records.get(id), ...data})}),
      get: async () => ({docs: [...records].map(([id, data]) => ({id, data: () => data}))}),
    })}};
    throw new Error(`Unexpected dependency ${name}`);
  }};
  vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, "../src/controllers/schedule.controller.js"), "utf8"), context);
  return {controller: context.module.exports, records};
}

test("admin and staff can disable and reopen slots using their stored roles without Firebase role claims", async () => {
  for (const role of ["admin", "staff"]) {
    const {controller, records} = controllerFixture();
    const req = {auth: {user: {uid: role, role}, claims: {}}, params: {id: "slot"},
      body: {id: "slot", date: "2026-10-06", time: "09:00", capacity: 3, isOpen: false}};
    await controller.saveAvailabilitySlot(req, {json() {}});
    assert.equal(records.get("slot").isOpen, false);
    assert.equal(records.get("slot").disabled, true);
    req.body.isOpen = true;
    await controller.saveAvailabilitySlot(req, {json() {}});
    assert.equal(records.get("slot").disabled, false);
    assert.equal(records.get("slot").status, "Open");
    await controller.disableAvailabilitySlot(req, {json() {}});
    assert.equal(records.get("slot").isOpen, false);
    assert.equal(records.get("slot").date, "2026-10-06");
  }
});

test("customers and unauthenticated users cannot write slots, including with a forged admin claim", async () => {
  const {controller, records} = controllerFixture();
  for (const user of [{uid: "customer", role: "customer"}, undefined]) {
    const req = {auth: {user, claims: {role: "admin"}}, params: {id: "slot"}, body: {id: "slot", isOpen: false, capacity: 3}};
    await assert.rejects(controller.saveAvailabilitySlot(req, {json() {}}), {statusCode: 403});
    await assert.rejects(controller.disableAvailabilitySlot(req, {json() {}}), {statusCode: 403});
  }
  assert.equal(records.size, 0);
});

test("slot endpoint validates capacity, identifiers and time and lets authenticated customers read", async () => {
  const {controller, records} = controllerFixture();
  const req = {auth: {user: {uid: "staff", role: "staff"}}, params: {id: "slot"}, body: {id: "slot", capacity: 3, isOpen: true}};
  for (const change of [{capacity: 0}, {capacity: -1}, {capacity: 1.5}, {id: "other"}, {isOpen: "false"}, {time: "25:00"}]) {
    await assert.rejects(controller.saveAvailabilitySlot({...req, body: {...req.body, ...change}}, {json() {}}), {statusCode: 400});
  }
  assert.equal(records.size, 0);
  await controller.saveAvailabilitySlot(req, {json() {}});
  let response;
  await controller.listAvailabilitySlots({auth: {user: {role: "customer"}}}, {json(data) {response = data;}});
  assert.equal(response.slots[0].id, "slot");
  await assert.rejects(controller.listAvailabilitySlots({}, {json() {}}), {statusCode: 401});
});

test("backend schedule authorization accepts admin/staff and denies customers or missing roles", () => {
  const authorize = verifyRole(["admin", "staff"]);
  for (const role of ["admin", "staff", " ADMIN ", "Staff", "customer", "", undefined]) {
    let result;
    authorize({auth: {user: {role}, claims: {role: "admin"}}}, {}, (error) => {result = error;});
    const allowed = ["admin", "staff"].includes(String(role || "").trim().toLowerCase());
    assert.equal(result?.statusCode, allowed ? undefined : 403);
  }
});

test("Firestore deploy configuration points to the checked-in rules", () => {
  const root = path.resolve(__dirname, "../..");
  const config = JSON.parse(fs.readFileSync(path.join(root, "firebase.json"), "utf8"));
  assert.equal(config.firestore.rules, "firestore.rules");
  assert.ok(fs.existsSync(path.join(root, config.firestore.rules)));
});

test("schedule rule declarations cover slot collections and nested documents using trusted roles", () => {
  const rules = fs.readFileSync(path.resolve(__dirname, "../../firestore.rules"), "utf8");
  for (const collection of ["availabilitySlots", "schedules", "timeSlots", "slotManagement"]) {
    assert.ok(rules.includes(`match /${collection}/{document=**} {\n      allow read: if hasActiveSession();\n      allow write: if canManageSchedules();`.replaceAll("\n", rules.includes("\r\n") ? "\r\n" : "\n")));
  }
  assert.match(rules, /request\.auth\.token\.get\('role', ''\) in \['admin', 'staff'\]/);
  assert.match(rules, /data\.get\('revokedBefore', 0\)/);
});
