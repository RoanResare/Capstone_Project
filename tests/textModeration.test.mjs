import assert from "node:assert/strict";
import { test } from "node:test";
import {
  ACCOUNT_TEXT_FIELDS, APPOINTMENT_TEXT_FIELDS, MODERATION_ERROR_MESSAGE,
  assertAppropriateText, containsInappropriateText, getTextValidationErrors,
} from "../shared/textModeration.mjs";

test("blocks common English, Filipino, Taglish, targeted abuse, threats, and obfuscation", () => {
  for (const text of [
    "FUCK", "f***k", "putanginamoka", "Gago ka", "You are gago", "n1gga", "f.a.g.g.o.t",
    "kill all gays", "I will kill you", "I will hurt you", "g0bl0k", "g o b l o k", "gobloooook",
    `g${String.fromCodePoint(0x043e)}bl${String.fromCodePoint(0x043e)}k`,
    `f${String.fromCodePoint(0x200b)}uck`, "ＦＵＣＫ",
  ]) assert.equal(containsInappropriateText(text), true);
});

test("allows ordinary names, identities, nationality, religion, veterinary notes, and support discussion", () => {
  for (const text of [
    "Dick Smith", "Bitch Creek Veterinary Clinic", "Milo", "Shih Tzu", "Cockapoo", "O'Malley",
    "LGBTQ+ customers are welcome", "My friend is gay and transgender", "Black Filipino customer",
    "Muslim and Catholic families", "Needs assistance with anal glands and medication",
    "I am worried about self-harm and need support", "People told me to kill myself and I need help", "I want to die and need support",
    "Mamatay ako is a lyric I heard",
  ]) assert.equal(containsInappropriateText(text), false);
});

test("email addresses are excluded while free-text account fields remain moderated", () => {
  assert.deepEqual(getTextValidationErrors({ fullName: "Maria Santos", username: "maria", email: "fuck@example.com" }, ACCOUNT_TEXT_FIELDS), {});
  assert.equal(getTextValidationErrors({ fullName: "gago" }, ACCOUNT_TEXT_FIELDS).fullName, MODERATION_ERROR_MESSAGE);
});

test("nested appointment reasons are validated without echoing submitted text", () => {
  const errors = getTextValidationErrors({ decision: { reason: "Please stop, gago ka." } }, APPOINTMENT_TEXT_FIELDS);
  assert.equal(errors["decision.reason"], MODERATION_ERROR_MESSAGE);
  assert.throws(() => assertAppropriateText({ decision: { reason: "Please stop, gago ka." } }, APPOINTMENT_TEXT_FIELDS), error =>
    error.code === "INVALID_TEXT" && error.fields["decision.reason"] === MODERATION_ERROR_MESSAGE && !error.message.includes("gago"));
});
