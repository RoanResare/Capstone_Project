import assert from "node:assert/strict";
import { test } from "node:test";
import { containsInappropriatePetText, getPetTextErrors, assertAppropriatePetText } from "../shared/petTextValidation.mjs";

test("rejects English and Filipino profanity, slurs, and common obfuscation", () => {
  for (const text of ["FUCK", "shit!", "f u c k", "f.u.c.k", "fuuuck", "sh1t", "sh!t", "f*ck", "b*tch", "ＦＵＣＫ", "f\u200buck", "fúck", "putang ina", "pakyu", "gago", "nigger", "n1gga", "faggot"]) {
    assert.equal(containsInappropriatePetText(text), true, text);
    assert.ok(getPetTextErrors({ petName: text }).petName);
    assert.ok(getPetTextErrors({ petName: "Milo", notes: `Note: ${text}.` }).notes);
  }
});
test("allows ordinary names and veterinary notes without substring false positives", () => {
  for (const text of ["Milo", "Shih Tzu", "Cockapoo", "Cassie", "Spice", "Buttercup", "Scunthorpe", "Needs assistance with anal glands; no food allergy.", "Please trim nails and give medication.", "Mabait at masiglang aso.", "O'Malley", "Puti"]) {
    assert.equal(containsInappropriatePetText(text), false, text);
    assert.deepEqual(getPetTextErrors({ petName: "Milo", notes: text }), {});
  }
});
test("requires a pet name, bounds field sizes, and reports fields without echoing harmful input", () => {
  assert.ok(getPetTextErrors({ petName: " " }).petName);
  assert.ok(getPetTextErrors({ petName: "x".repeat(61) }).petName);
  assert.ok(getPetTextErrors({ petName: "Milo", notes: "x".repeat(501) }).notes);
  assert.ok(getPetTextErrors({ petName: "Milo", notes: {} }).notes);
  assert.throws(() => assertAppropriatePetText({ petName: "Milo", notes: "fuck" }), error => error.code === "INVALID_PET_TEXT" && !error.message.includes("fuck"));
});

test("blocks screenshot examples and Filipino inflections, numeric suffixes, spacing and masking", () => {
  for (const text of ["tanginamo", "tanginamo0", "tanginamo123", "TANGINAMO", "tang ina mo", "t.a.n.g.i.n.a.m.o", "t4ng1n4m0", "taenamo", "tanginamong", "gagoka", "tangin*mo", "nigga123"]) {
    assert.ok(getPetTextErrors({ petName: text }).petName, text);
    assert.ok(getPetTextErrors({ petName: "Milo", notes: text }).notes, text);
  }
});
