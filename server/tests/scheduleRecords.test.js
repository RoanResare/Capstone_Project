const assert = require("node:assert/strict");
const { test } = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { ApiError } = require("../src/utils/ApiError");

function fixture(records) {
  const collection = (filter = () => true, limit = Infinity, cursor = "") => ({
    where: (field, _op, value) => collection(record => record[field] === value),
    orderBy: () => collection(filter, limit, cursor),
    limit: size => collection(filter, size, cursor),
    startAfter: value => collection(filter, limit, value),
    get: async () => ({ docs: records.filter(filter).filter(record => record.id > cursor)
      .sort((a, b) => a.id.localeCompare(b.id)).slice(0, limit)
      .map(record => ({ id: record.id, data: () => record })) }),
  });
  const context = { module: { exports: {} }, require(id) {
    if (id === "../config/firebaseAdmin") return { db: { collection: () => collection() } };
    if (id === "../utils/ApiError") return { ApiError };
    throw new Error(id);
  } };
  vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, "../src/services/scheduleRecords.service.js"), "utf8"), context);
  return context.module.exports;
}

test("customers recover canonical, legacy ownerId and email-only profiles without accessing other accounts", async () => {
  const service = fixture([
    { id: "canonical", customerId: "customer" },
    { id: "legacy", ownerId: "customer" },
    { id: "email", customerEmail: "customer@example.com" },
    { id: "conflict", customerId: "other", customerEmail: "customer@example.com" },
    { id: "owner-conflict", ownerId: "other", customerEmail: "customer@example.com" },
    { id: "unlinked" },
  ]);
  const result = await service.listRecords("pets", { uid: "customer", email: "customer@example.com", role: "customer" });
  assert.equal(result.records.length, 3);
  assert.equal(result.records.every(record => record.customerId === "customer"), true);
  assert.deepEqual(new Set(result.records.map(record => record.id)), new Set(["canonical", "legacy", "email"]));
});

test("admin and staff can load all calendar bookings by stored role without custom claims or createdAt", async () => {
  const service = fixture(Array.from({ length: 550 }, (_, i) => ({ id: String(i).padStart(3, "0"), status: "Pending" })));
  for (const role of ["admin", "staff"]) {
    const first = await service.listRecords("appointments", { role }, { limit: 500 });
    const second = await service.listRecords("appointments", { role }, { cursor: first.nextCursor });
    assert.equal(first.records.length, 500);
    assert.equal(second.records.length, 50);
    assert.equal(second.nextCursor, "");
    assert.equal(new Set([...first.records, ...second.records].map(record => record.id)).size, 550);
  }
});

test("missing or unsupported roles cannot read shared records", async () => {
  const service = fixture([]);
  for (const user of [undefined, {}, { role: "visitor" }]) {
    await assert.rejects(service.listRecords("pets", user), { statusCode: 403 });
  }
});
