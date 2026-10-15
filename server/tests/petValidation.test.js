const assert = require("node:assert/strict");
const { test } = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { ApiError } = require("../src/utils/ApiError");

function fixture(initial = {}) {
  const records = new Map(Object.entries(initial));
  const writes = [];
  const db = {
    collection: name => ({ doc: id => ({ key: `${name}/${id}` }) }),
    runTransaction: async action => {
      const pending = [];
      await action({
        get: async ref => ({ exists: records.has(ref.key), data: () => records.get(ref.key) }),
        set: (ref, data) => pending.push({ ref, data }),
      });
      for (const { ref, data } of pending) { records.set(ref.key, { ...records.get(ref.key), ...data }); writes.push(data); }
    },
  };
  const filename = path.resolve(__dirname, "../src/controllers/pet.controller.js");
  const context = { module: { exports: {} }, require(id) {
    if (id === "../config/firebaseAdmin") return { db };
    if (id === "../utils/ApiError") return { ApiError };
    throw new Error(id);
  } };
  vm.runInNewContext(fs.readFileSync(filename, "utf8"), context, { filename, importModuleDynamically: vm.constants.USE_MAIN_CONTEXT_DEFAULT_LOADER });
  return { records, writes, save: (body = {}, user = {}) => context.module.exports.savePet({
    params: { id: "pet" }, body: { id: "pet", petName: "Milo", notes: "Trim nails gently.", petType: "Dog", breed: "Aspin", gender: "Male", ...body },
    auth: { user: { uid: "owner", role: "customer", email: "owner@example.com", fullName: "Owner", ...user } },
  }, { json() {} }) };
}
test("API rejects inappropriate names and notes even when the form is bypassed", async () => {
  for (const body of [{ petName: "fuck" }, { notes: "n1gga" }, { notes: "putang ina" }, { petName: "tanginamo" }, { notes: "tanginamo0" }]) {
    const f = fixture();
    await assert.rejects(f.save(body), error => error.statusCode === 400 && error.details.code === "INVALID_PET_TEXT");
    assert.equal(f.writes.length, 0);
  }
});
test("valid creates bind ownership to the signed-in user and ignore clinical-field injection", async () => {
  const f = fixture();
  await f.save({ customerId: "someone-else", medicalRecords: ["forged"], extra: "ignored" });
  const saved = f.records.get("pets/pet");
  assert.equal(saved.customerId, "owner");
  assert.equal(saved.customerEmail, "owner@example.com");
  assert.equal(saved.medicalRecords.length, 0);
  assert.equal(saved.extra, undefined);
});
test("updates preserve clinical history, enforce ownership and allow staff edits", async () => {
  const old = { customerId: "owner", medicalRecords: ["clinic record"], lastVisit: "2026-01-01" };
  const f = fixture({ "pets/pet": old });
  await f.save({ notes: "Calm pet", medicalRecords: ["forged"] });
  assert.equal(f.records.get("pets/pet").medicalRecords[0], "clinic record");
  await assert.rejects(f.save({}, { uid: "intruder" }), error => error.statusCode === 403);
  await f.save({ notes: "Updated by staff" }, { uid: "staff", role: "staff" });
  assert.equal(f.records.get("pets/pet").notes, "Updated by staff");
});
test("rejects deleted pets, malformed records, and invalid genders", async () => {
  await assert.rejects(fixture({ "deletedPets/pet": {} }).save(), error => error.statusCode === 409);
  for (const body of [{ id: "wrong" }, { gender: "Others" }, { petName: "" }, { breed: "" }, { notes: "x".repeat(501) }]) {
    await assert.rejects(fixture().save(body), error => error.statusCode === 400);
  }
});
test("Firestore pet owner rule remains as explicitly requested", () => {
  const rules = fs.readFileSync(path.resolve(__dirname, "../../firestore.rules"), "utf8");
  const petRules = rules.slice(rules.indexOf("match /pets/"), rules.indexOf("match /notifications/"));
  assert.match(petRules, /allow read: if request.auth != null/);
  assert.match(petRules, /allow create, update: if request.auth != null && request.resource.data.ownerId == request.auth.uid/);
});
