import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";
import { createRequire } from "node:module";

const portal = readFileSync(new URL("../src/app/components/portal/PortalPage.jsx", import.meta.url), "utf8");
const customer = readFileSync(new URL("../src/app/components/CustomerProfile.jsx", import.meta.url), "utf8");
const otp = readFileSync(new URL("../src/app/components/OtpVerification.jsx", import.meta.url), "utf8");
const access = readFileSync(new URL("../server/src/database/browserAccess.js", import.meta.url), "utf8");

test("appointment review resolves photos only by the appointment pet record id", () => {
  assert.match(portal, /find\(\(pet\) => pet\.id === appointment\.petRecordId\)/);
  assert.match(portal, /associatedPet\?\.photoURL/);
  assert.match(portal, /No pet photo uploaded or linked pet record unavailable/);
  assert.doesNotMatch(portal, /associatedPet\s*\|\|\s*.*petName/);
});

test("backend pet reads require the owner or an authenticated manager role", () => {
  assert.match(access, /const manager = \["admin", "staff"\]\.includes\(user\.role\)/);
  assert.match(access, /\["appointments", "pets"\]\.includes\(collection\) && \(manager \|\| \(record && ownsRecord\(record, user\)\)\)/);
  assert.match(access, /function deny\(\) \{ throw new ApiError\(403/);
});

test("pet photo record access is owner scoped for customers and role scoped for Admin/Staff", () => {
  const source = access;
  const require = createRequire(import.meta.url);
  const { ApiError } = require("../server/src/utils/ApiError.js");
  const context = { module: { exports: {} }, require(id) {
    if (id === "../utils/ApiError") return { ApiError };
    if (id === "../services/scheduleRecords.service") return { ownsRecord: (record, user) => record.customerId === user.uid };
    if (id === "../../../shared/usernamePolicy.json") return { allowedCharacters: "a-zA-Z0-9._", minLength: 3, maxLength: 30 };
    throw new Error(id);
  } };
  vm.runInNewContext(source, context);
  const assertRead = context.module.exports.assertRead;
  const record = { customerId: "alice", photoURL: "private-image-data" };
  assert.doesNotThrow(() => assertRead("pets", "p1", record, { uid: "alice", user: { uid: "alice", role: "customer" } }));
  assert.throws(() => assertRead("pets", "p1", record, { uid: "bob", user: { uid: "bob", role: "customer" } }), error => error.statusCode === 403);
  for (const role of ["admin", "staff"]) assert.doesNotThrow(() => assertRead("pets", "p1", record, { uid: role, user: { uid: role, role } }));
  assert.throws(() => assertRead("pets", "p1", record, { uid: "", user: null }), error => error.statusCode === 403);
});

test("manager pet records expose photo thumbnails, fallback, and accessible viewer", () => {
  assert.match(portal, /record\.photoURL \? <button/);
  assert.match(portal, /aria-label=\{`View \$\{record\.petName\} photo`\}/);
  assert.match(portal, /No pet photo uploaded/);
  assert.match(portal, /function PetPhotoDialog/);
  assert.match(portal, /aria-modal="true"/);
});

test("customer photo picker preserves optional photo preview and supports image replacement/removal", () => {
  assert.match(customer, /Pet Photo \(Optional\)/);
  assert.match(customer, /createImageBitmap\(file\)/);
  assert.match(customer, /setPetForm\(\(current\) => \(\{ \.\.\.current, photoURL: String\(reader\.result/);
  assert.match(customer, /Remove photo/);
  assert.match(customer, /accept="image\/jpeg,image\/png,image\/webp"/);
});

test("OTP page reuses the auth backdrop and retains its verify and resend handlers", () => {
  assert.match(otp, /import \{ AuthPageBackdrop \} from "\.\/AuthPageBackdrop\.jsx"/);
  assert.match(otp, /<AuthPageBackdrop \/>/);
  assert.match(otp, /verifyPendingOtp\(otpCode\)/);
  assert.match(otp, /resendOtp\(\)/);
  assert.match(otp, /otpExpiresAt/);
  assert.match(otp, /resendAvailableAt/);
});
