import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const policy = readFileSync(new URL("../src/app/data/terms-and-privacy.txt", import.meta.url), "utf8");
const signup = readFileSync(new URL("../src/app/components/CustomerSignup.jsx", import.meta.url), "utf8");
const login = readFileSync(new URL("../src/app/components/UnifiedLogin.jsx", import.meta.url), "utf8");
const dialog = readFileSync(new URL("../src/app/components/PolicyDialog.jsx", import.meta.url), "utf8");

test("shared policy source contains both complete documents and the revised no-show provisions", () => {
  assert.ok(policy.length > 25_000);
  assert.match(policy, /^Terms and Conditions\nSection 1\. General Terms/m);
  for (let section = 1; section <= 10; section += 1) {
    assert.ok(policy.includes(`Section ${section}.`), `Terms and Conditions Section ${section} is present`);
  }
  assert.match(policy, /Section 5\. Appointment Cancellation, Rejection, Expiration, and No-Shows/);
  assert.match(policy, /Section 6\. No-Show Policy and Temporary Account Suspension/);
  assert.match(policy, /three \(3\) no-shows[\s\S]*?three \(3\) days/i);
  assert.match(policy, /[\r\n\f]+Privacy Policy[\r\n\f]+Section 1\. General Terms/);
  for (let section = 1; section <= 11; section += 1) {
    assert.ok(policy.includes(`Section ${section}.`), `Privacy Policy Section ${section} is present`);
  }
  assert.match(policy, /Section 12\. Policy Updates and Contact Information/);
  assert.match(policy, /12\.1 Changes to This Privacy Policy/);
  assert.match(policy, /12\.2 Contact Information/);
});

test("policy contact uses approved format and shared dialog is wired to signup and login", () => {
  assert.equal((policy.match(/\+63 950 251 1754/g) || []).length, 2);
  assert.doesNotMatch(policy, /\+63 0950 251 1754/);
  assert.match(dialog, /terms-and-privacy\.txt\?raw/);
  assert.match(signup, /<PolicyDialog/);
  assert.match(signup, /onReadToBottom=\{\(\) => setTermsRead\(true\)\}/);
  assert.match(signup, /disabled=\{!termsRead \|\| isSubmitting\}/);
  assert.match(signup, /disabled=\{!termsRead \|\| !termsAccepted \|\| isSubmitting\}/);
  assert.match(login, /Terms and Conditions/);
  assert.match(login, /Privacy Policy/);
  assert.match(login, /<PolicyDialog title=\{policyTitle\} initialDocument=\{policyDocument\}/);
});
