import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";
import vm from "node:vm";
import { getPhoneSubscriberInput, normalizePhilippineMobileNumber } from "../src/app/utils/phoneNumber.js";

const require = createRequire(import.meta.url);
const backendPhone = require("../server/src/utils/phoneNumber.js");
const { ApiError } = require("../server/src/utils/ApiError.js");
const canonical = "+63 9620614953";
const validNumbers = ["9620614953", "09620614953", "+639620614953", "+63 9620614953", "639620614953", "0962-061-4953"];
const invalidNumbers = ["962061495", "96206149530", "+6396206149530", "096206149530", "8620614953", "+649620614953", "+6309620614953", "abc9620614953", "962061495x"];

test("frontend and backend accept Philippine mobile formats and reject malformed numbers", () => {
  for (const normalize of [normalizePhilippineMobileNumber, backendPhone.normalizePhilippineMobileNumber]) {
    for (const value of validNumbers) assert.equal(normalize(value), canonical, value);
    for (const value of invalidNumbers) assert.equal(normalize(value), "", value);
  }
  for (const value of validNumbers) assert.equal(getPhoneSubscriberInput(value), "9620614953");
  assert.equal(getPhoneSubscriberInput("096206149530"), "96206149530");
  assert.equal(getPhoneSubscriberInput("abc9620614953"), "abc9620614953");
});

test("registration endpoint accepts both local and international input and normalizes duplicate checks", async () => {
  const lookups = [];
  const context = {
    module: { exports: {} },
    require(name) {
      if (name === "../utils/phoneNumber") return backendPhone;
      if (name === "../utils/ApiError") return { ApiError };
      if (name === "../utils/emailValidation") return require("../server/src/utils/emailValidation.js");
      if (name === "../constants/auth") return { USER_ROLES: { CUSTOMER: "customer", ADMIN: "admin", STAFF: "staff" } };
      if (name === "../utils/setupGuard") return { assertAuthSetupReady() {} };
      if (name === "../config/firebaseAdmin") return { auth: {
        async getUserByEmail() { throw Object.assign(new Error("Not found"), { code: "auth/user-not-found" }); },
      } };
      if (name === "../services/registrationSecurity.service") return { validateRegistrationSecurity: async () => ({}) };
      if (name === "../services/user.service") return {
        findUserByEmailCaseInsensitive: async () => null,
        getUserByPhone: async (phone) => { lookups.push(phone); return null; },
      };
      return {};
    },
  };
  vm.runInNewContext(readFileSync(new URL("../server/src/controllers/auth.controller.js", import.meta.url), "utf8"), context);
  const check = context.module.exports.checkCustomerRegistrationAvailability;
  for (const phone of validNumbers) {
    let status;
    const res = { status(value) { status = value; return this; }, json(value) { return value; } };
    const result = await check({ body: { email: "new-customer@example.test", phone } }, res);
    assert.equal(status, 200);
    assert.equal(result.available, true);
    assert.equal(lookups.at(-1), canonical);
  }
  for (const phone of invalidNumbers) {
    await assert.rejects(check({ body: { email: "new-customer@example.test", phone } }, {}),
      { statusCode: 400, message: backendPhone.PH_MOBILE_ERROR });
  }
});

test("phone lookups match existing domestic numbers against international signup input", async () => {
  let reads = 0;
  const document = { id: "existing-customer", data: () => ({ phone: "09620614953",
    username: "existing_customer", role: "customer", accountStatus: "active" }) };
  const context = {
    module: { exports: {} },
    require(name) {
      if (name === "../utils/phoneNumber") return backendPhone;
      if (name === "../utils/ApiError") return { ApiError };
      if (name === "../config/env") return { env: {} };
      if (name === "../constants/auth") return {
        USER_ROLES: { CUSTOMER: "customer", ADMIN: "admin", STAFF: "staff" },
        USER_STATUSES: { ACTIVE: "active" }, FRAUD_STATUSES: { NORMAL: "normal" }, USERS_COLLECTION: "users",
      };
      if (name === "../config/firebaseAdmin") return { db: { collection() {
        return { where() { return this; }, limit() { return this; }, async get() {
          reads += 1;
          return reads % 2 ? { empty: true, docs: [] } : { empty: false, docs: [document] };
        } };
      } } };
      return {};
    },
  };
  vm.runInNewContext(readFileSync(new URL("../server/src/services/user.service.js", import.meta.url), "utf8"), context);
  for (const number of validNumbers) {
    const user = await context.module.exports.getUserByPhone(number);
    assert.equal(user.uid, "existing-customer", number);
  }
});
