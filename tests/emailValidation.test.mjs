import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { test } from "node:test";
import { isValidEmail, ILLEGITIMATE_EMAIL_ERROR } from "../src/app/utils/emailValidation.js";
import { getPasswordRecoveryEmailError } from "../src/app/utils/passwordRecovery.js";
const backend = createRequire(import.meta.url)("../server/src/utils/emailValidation.js");

test("email validation agrees across frontend and backend, including legitimate non-.com domains", () => {
  for (const email of ["user@gmail.com", "user+tag@example.org", "user@yahoo.com.ph", " User@Example.PH "]) {
    assert.equal(isValidEmail(email), true);
    assert.equal(backend.isValidEmail(email), true);
    assert.equal(getPasswordRecoveryEmailError(email), "");
  }
});

test("invalid emails produce exactly the requested message, without punctuation", () => {
  assert.equal(ILLEGITIMATE_EMAIL_ERROR, "Illegitimate email cannot be verified");
  for (const email of ["fake", "a@@b.com", "a..b@gmail.com", "a@-bad.com", "a@bad-.com", "a @gmail.com", "a@gmail.com.", `${"a".repeat(65)}@gmail.com`]) {
    assert.equal(isValidEmail(email), false);
    assert.equal(getPasswordRecoveryEmailError(email), ILLEGITIMATE_EMAIL_ERROR);
    assert.throws(() => backend.assertValidEmail(email), { message: ILLEGITIMATE_EMAIL_ERROR });
  }
});
