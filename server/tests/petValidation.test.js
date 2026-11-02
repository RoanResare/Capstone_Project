const assert = require("node:assert/strict");
const { test } = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { ApiError } = require("../src/utils/ApiError");
const sharp = require("../node_modules/sharp");

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
  const context = { module: { exports: {} }, Buffer, require(id) {
    if (id === "../config/postgresDatabase") return { db };
    if (id === "../utils/ApiError") return { ApiError };
    if (id === "node:zlib") return require("node:zlib");
    if (id === "sharp") return sharp;
    throw new Error(id);
  } };
  vm.runInNewContext(fs.readFileSync(filename, "utf8"), context, { filename, importModuleDynamically: vm.constants.USE_MAIN_CONTEXT_DEFAULT_LOADER });
  return { records, writes, controller: context.module.exports, save: (body = {}, user = {}) => context.module.exports.savePet({
    params: { id: "pet" }, body: { id: "pet", petName: "Milo", notes: "Trim nails gently.", petType: "Dog", breed: "Aspin", gender: "Male", ...body },
    auth: { user: { uid: "owner", role: "customer", email: "owner@example.com", fullName: "Owner", ...user } },
  }, { json() {} }) };
}
function testPng(red) {
  const crc = bytes => { let value = 0xffffffff; for (const byte of bytes) { value ^= byte; for (let i = 0; i < 8; i++) value = value >>> 1 ^ (value & 1 ? 0xedb88320 : 0); } return (value ^ 0xffffffff) >>> 0; };
  const chunk = (name, data) => { const type = Buffer.from(name); const size = Buffer.alloc(4); size.writeUInt32BE(data.length); const checksum = Buffer.alloc(4); checksum.writeUInt32BE(crc(Buffer.concat([type, data]))); return Buffer.concat([size, type, data, checksum]); };
  const header = Buffer.alloc(13); header.writeUInt32BE(1, 0); header.writeUInt32BE(1, 4); header.set([8, 6, 0, 0, 0], 8);
  return `data:image/png;base64,${Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", header), chunk("IDAT", require("node:zlib").deflateSync(Buffer.from([0, red, 0, 0, 255]))), chunk("IEND", Buffer.alloc(0))]).toString("base64")}`;
}
test("photo validation fully decodes valid JPG, PNG, and WebP and rejects corrupt content", async () => {
  const validate = fixture().controller.validatePetPhoto;
  const image = testPng(255);
  const jpeg = await sharp({ create: { width: 2, height: 2, channels: 3, background: "#d86b52" } }).jpeg().toBuffer();
  const webp = await sharp({ create: { width: 2, height: 2, channels: 3, background: "#4f91a0" } }).webp().toBuffer();
  await assert.doesNotReject(() => validate(image));
  await assert.doesNotReject(() => validate(`data:image/jpeg;base64,${jpeg.toString("base64")}`));
  await assert.doesNotReject(() => validate(`data:image/webp;base64,${webp.toString("base64")}`));
  await assert.rejects(validate("data:image/png;base64," + Buffer.from("not an image").toString("base64")), error => error.statusCode === 400);
  await assert.rejects(validate(`data:image/jpeg;base64,${jpeg.subarray(0, jpeg.length - 12).toString("base64")}`), error => error.statusCode === 400);
  await assert.rejects(validate(`data:image/webp;base64,${webp.subarray(0, webp.length - 8).toString("base64")}`), error => error.statusCode === 400);
  await assert.rejects(validate("data:image/gif;base64,R0lGODlh"), error => error.statusCode === 400);
  const corruptPng = Buffer.from(image.slice(image.indexOf(",") + 1), "base64");
  corruptPng[43] ^= 0xff;
  await assert.rejects(validate(`data:image/png;base64,${corruptPng.toString("base64")}`), error => error.statusCode === 400);
  await assert.rejects(validate(`data:image/png;base64,${"A".repeat(1_450_001)}`), error => error.statusCode === 413);
});
test("pet photo API supports optional save, replacement, and removal while retaining ownership checks", async () => {
  const f = fixture();
  await f.save();
  assert.equal(f.records.get("pets/pet").photoURL, undefined);
  await f.save({ photoURL: testPng(255) });
  const first = f.records.get("pets/pet").photoURL;
  await f.save({ photoURL: testPng(0) });
  assert.notEqual(f.records.get("pets/pet").photoURL, first);
  await assert.rejects(f.save({ photoURL: "" }, { uid: "intruder" }), error => error.statusCode === 403);
  assert.notEqual(f.records.get("pets/pet").photoURL, "");
  await f.save({ photoURL: "" });
  assert.equal(f.records.get("pets/pet").photoURL, "");
});
test("API rejects inappropriate names and notes even when the form is bypassed", async () => {
  for (const body of [{ petName: "fuck" }, { notes: "n1gga" }, { notes: "putang ina" }, { petName: "tanginamo" }, { notes: "tanginamo0" }, { petName: "goblok" }, { notes: "g0b10k123" }, { notes: "banci" }, { notes: "你这个傻逼" }, { notes: "пидор" }]) {
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
test("API rejects an inappropriate custom breed even when the form is bypassed", async () => {
  const f = fixture();
  await assert.rejects(f.save({ breed: "gago" }), error => error.statusCode === 400 && error.details.code === "INVALID_PET_TEXT");
  assert.equal(f.writes.length, 0);
});

test("direct Firestore pet writes cannot bypass API moderation", () => {
  const rules = fs.readFileSync(path.resolve(__dirname, "../../firestore.rules"), "utf8");
  const petRules = rules.slice(rules.indexOf("match /pets/"), rules.indexOf("match /notifications/"));
  assert.match(petRules, /allow read: if request.auth != null/);
  assert.match(petRules, /allow create, update: if false/);
});
