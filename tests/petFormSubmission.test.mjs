import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { getPetTextErrors } from "../shared/petTextValidation.mjs";

// Execute the production submit handler with controlled persistence and UI ports.
const source = readFileSync(new URL("../src/app/components/CustomerProfile.jsx", import.meta.url), "utf8");
const handler = source.slice(source.indexOf("  const savePet = async (event) => {"), source.indexOf("  const removePet = async"));
function fixture(fields) {
  const calls = { saves: [], success: [], errors: [], feedback: [], focused: [], prevented: 0, reset: 0 };
  const env = {
    isSavingPet: false, getPetTextErrors,
    petForm: { petName: "Milo", petType: "Dog", breed: "Aspin", gender: "Male", notes: "Please trim nails gently.", ageValue: "12", ageUnit: "months", weightKg: "5", photoURL: "", ...fields },
    setPetTextErrors: value => { calls.fields = value; },
    setFeedback: value => calls.feedback.push(value),
    toast: { error: value => calls.errors.push(value), success: value => calls.success.push(value) },
    petSectionRef: { current: { querySelector: selector => ({ focus: () => calls.focused.push(selector) }) } },
    setIsSavingPet() {}, customerPetRecords: [], customer: { uid: "customer", email: "customer@example.com" },
    profileForm: { fullName: "Customer" },
    savePetRecord: async record => { calls.saves.push(record); return true; },
    setPetForm: () => { calls.reset++; }, buildEmptyPetForm: () => ({}), pendingBookingServiceId: "",
  };
  const submit = new Function(...Object.keys(env), `${handler}\nreturn savePet;`)(...Object.values(env));
  return { calls, submit: () => submit({ preventDefault() { calls.prevented++; } }) };
}
test("actual form handler blocks each inappropriate field before persistence or success UI", async () => {
  for (const field of ["petName", "notes"]) {
    for (const value of ["tanginamo", "tanginamo0", "T4NG1N4M0", "tang ina mo", "fuck", "nigga123", "goblok", "G0B10K123", "g.o.b.l.o.k", "bangsat", "banci", "maricón", "пидор", "你这个傻逼", "씨발", "madarchod"]) {
      const f = fixture({ [field]: value });
      await f.submit();
      assert.equal(f.calls.prevented, 1);
      assert.equal(f.calls.saves.length, 0, `${field}: ${value}`);
      assert.equal(f.calls.success.length, 0);
      assert.equal(f.calls.reset, 0, "rejection must preserve the form");
      assert.equal(f.calls.errors.length, 1);
      assert.ok(f.calls.fields[field]);
      assert.equal(f.calls.feedback.at(-1).type, "error");
      assert.deepEqual(f.calls.focused, [`[name="${field}"]`]);
    }
  }
});
test("valid form saves once and reports success only after persistence resolves", async () => {
  const f = fixture({});
  await f.submit();
  assert.equal(f.calls.saves.length, 1);
  assert.equal(f.calls.success.length, 1);
  assert.equal(f.calls.errors.length, 0);
  assert.equal(f.calls.reset, 1);
});
test("welcome banner uses normal document flow and no banner-dependent scroll offsets", () => {
  const banner = source.slice(source.indexOf('aria-label="Customer welcome"'), source.indexOf('aria-label="Customer welcome"') + 450);
  assert.doesNotMatch(banner, /sticky|fixed|top-16|z-30/);
  assert.doesNotMatch(source, /customer-banner-height|welcomeBannerRef|ResizeObserver/);
  assert.match(source, /ref=\{petSectionRef\} className="[^\"]*scroll-mt-24/);
});
