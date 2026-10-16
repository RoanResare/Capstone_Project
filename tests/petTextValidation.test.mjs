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
  for (const text of ["putanginamoka", "tanginaka", "tanginamo", "tanginamo0", "tanginamo123", "TANGINAMO", "tang ina mo", "t.a.n.g.i.n.a.m.o", "t4ng1n4m0", "taenamo", "tanginamong", "gagoka", "tangin*mo", "nigga123"]) {
    assert.ok(getPetTextErrors({ petName: text }).petName, text);
    assert.ok(getPetTextErrors({ petName: "Milo", notes: text }).notes, text);
  }
});

test("multilingual profanity and identity-directed abuse are rejected in both fields", () => {
  const cases = [
    "goblok", "goblog", "gobloknya", "tolol", "bangsat", "brengsek", "kontol", "ngentot", "pukimak", "bodoh", "jancok",
    "yawa", "pistengyawa", "bilat", "baklang salot", "kill all gays", "banci", "pondan", "tranny", "schwuchtel", "maricón",
    "mierda", "pendejo", "coño", "caralho", "buceta", "putain", "connard", "scheiße", "vaffanculo", "klootzak",
    "madarchod", "bhenchod", "chutiya", "मादरचोद", "புண்டை", "сука", "пидор", "كسمك", "شرموطة",
    "你这个傻逼", "他妈的", "死ね", "씨발", "개새끼", "ไอ้เหี้ย",
  ];
  for (const text of cases) {
    assert.ok(getPetTextErrors({ petName: text }).petName, text);
    assert.ok(getPetTextErrors({ petName: "Milo", notes: `Note: ${text}.` }).notes, text);
  }
});

test("Unicode, separators, repeated letters, masking and ambiguous leetspeak cannot disguise goblok", () => {
  for (const text of ["GOBLOK", "g0bl0k", "G0B10K", "g0b10k123", "gobloooook", "g o b l o k", "g.o.b.l.o.k", "gob-lok", "góbłök", "ｇｏｂｌｏｋ", "go\u200bblok", "gоblоk", "gob**k", "g#blok"]) {
    assert.equal(containsInappropriatePetText(text), true, text);
  }
});

test("neutral identities, safe multilingual text, pet names and clinical notes remain allowed", () => {
  for (const text of ["gay", "lesbian", "bisexual", "transgender", "LGBTQ", "bakla", "bayot", "bading", "hijra", "homo sapiens",
    "Milo", "Cassie", "Spice", "Shih Tzu", "Cockapoo", "Buttercup", "Scunthorpe", "Goby", "Block", "Bobby", "Lulu",
    "Needs assistance with anal glands and medication.", "May puke after medication; monitor vomiting.",
    "Mahal ko ang aking aso.", "Kucing saya sehat.", "我的猫需要疫苗", "Mi perro necesita vacunas."]) {
    assert.equal(containsInappropriatePetText(text), false, text);
  }
});

test("maximum-length punctuation and repeated letters do not stall matching", () => {
  for (const text of ["a".repeat(500), ".".repeat(500), "s".repeat(500), "notes ".repeat(83)]) {
    assert.equal(containsInappropriatePetText(text), false);
  }
});
