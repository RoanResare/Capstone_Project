import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import { canAcceptPolicyAgreement, reachedPolicyBottom } from "../src/app/utils/policyAgreement.js";
import { formatPolicyContent } from "../src/app/utils/policyText.mjs";

const terms = readFileSync(new URL("../src/app/data/terms-and-conditions.txt", import.meta.url), "utf8");
const privacy = readFileSync(new URL("../src/app/data/privacy-policy.txt", import.meta.url), "utf8");
const signup = readFileSync(new URL("../src/app/components/CustomerSignup.jsx", import.meta.url), "utf8");
const login = readFileSync(new URL("../src/app/components/UnifiedLogin.jsx", import.meta.url), "utf8");
const dialog = readFileSync(new URL("../src/app/components/PolicyDialog.jsx", import.meta.url), "utf8");

test("Terms and Conditions and Privacy Policy remain complete, separate policy sources", () => {
  assert.ok(terms.length > 8_000);
  assert.ok(privacy.length > 20_000);
  assert.match(terms, /^Terms and Conditions\r?\nSection 1\. General Terms/m);
  assert.match(terms, /Section 10\. Development Team and System Responsibilities/);
  assert.match(terms, /Section 6\. No-Show Policy and Temporary Account Suspension/);
  assert.match(terms, /three \(3\) no-shows[\s\S]*?three \(3\) days/i);
  assert.match(privacy, /^Privacy Policy\r?\nSection 1\. General Terms/m);
  assert.match(privacy, /Section 12\. Policy Updates and Contact Information/);
  assert.match(privacy, /12\.1 Changes to This Privacy Policy/);
  assert.match(privacy, /12\.2 Contact Information/);
  assert.equal(existsSync(new URL("../src/app/data/terms-and-privacy.txt", import.meta.url)), false);
  assert.equal((privacy.match(/\+63 950 251 1754/g) || []).length, 2);
  assert.doesNotMatch(privacy, /\+63 0950 251 1754/);
});

test("document formatting joins PDF line wraps without losing policy wording", () => {
  for (const source of [terms, privacy]) {
    const rendered = formatPolicyContent(source).map((block) => block.value).join(" ");
    const normalize = (value) => value.replace(/[\s\f]+/g, " ").trim();
    assert.equal(normalize(rendered), normalize(source));
  }
  const termsBlocks = formatPolicyContent(terms);
  const privacyBlocks = formatPolicyContent(privacy);
  assert.ok(termsBlocks.some((block) => block.value === "Terms and Conditions"));
  assert.ok(!termsBlocks.some((block) => block.value === "Privacy Policy"));
  assert.ok(privacyBlocks.some((block) => block.value === "Privacy Policy"));
  assert.ok(!privacyBlocks.some((block) => block.value === "Terms and Conditions"));
});

test("signup reads each modal independently and requires both bottoms plus manual agreement", () => {
  assert.match(dialog, /documentType === "terms"/);
  assert.match(dialog, /termsAndConditionsText : privacyPolicyText/);
  assert.match(dialog, /onScroll=\{\(event\)/);
  assert.match(signup, /termsRead, setTermsRead/);
  assert.match(signup, /privacyRead, setPrivacyRead/);
  assert.match(signup, /onReachedBottom=\{\(\) => \(policyDocument === "terms" \? setTermsRead\(true\) : setPrivacyRead\(true\)\)\}/);
  assert.match(signup, /disabled=\{!termsRead \|\| !privacyRead \|\| isSubmitting\}/);
  assert.match(signup, /I have read and agree to the Terms and Conditions and Privacy Policy\./);
  assert.match(signup, /disabled=\{!canAgree \|\| isSubmitting\}/);
  assert.match(signup, /\[termsAndConditionsText, privacyPolicyText\]/);
  assert.equal(canAcceptPolicyAgreement({ termsRead: false, privacyRead: false, accepted: true }), false);
  assert.equal(canAcceptPolicyAgreement({ termsRead: true, privacyRead: false, accepted: true }), false);
  assert.equal(canAcceptPolicyAgreement({ termsRead: false, privacyRead: true, accepted: true }), false);
  assert.equal(canAcceptPolicyAgreement({ termsRead: true, privacyRead: true, accepted: false }), false);
  assert.equal(canAcceptPolicyAgreement({ termsRead: true, privacyRead: true, accepted: true }), true);
});

test("bottom detection requires actual scroll position at the end", () => {
  assert.equal(reachedPolicyBottom({ scrollTop: 0, clientHeight: 500, scrollHeight: 2000 }), false);
  assert.equal(reachedPolicyBottom({ scrollTop: 1495, clientHeight: 500, scrollHeight: 2000 }), false);
  assert.equal(reachedPolicyBottom({ scrollTop: 1496, clientHeight: 500, scrollHeight: 2000 }), true);
});

test("login opens each document independently without signup agreement gating", () => {
  assert.match(login, /setPolicyDocument\("terms"\)/);
  assert.match(login, /setPolicyDocument\("privacy"\)/);
  assert.match(login, /<PolicyDialog documentType=\{policyDocument\}/);
  assert.doesNotMatch(login, /canAcceptPolicyAgreement|termsRead|privacyRead/);
});
