import { petTextBlacklist, unsegmentedPetTextBlacklist } from "./petTextBlacklist.mjs";

// Detection never rewrites or logs submitted text. This policy is shared by the
// browser and API so their normalization and field rules stay in sync.
const confusables = new Map([
  ["\u0430", "a"], ["\u0435", "e"], ["\u043e", "o"], ["\u0440", "p"], ["\u0441", "c"], ["\u0445", "x"],
  ["\u0456", "i"], ["\u0458", "j"], ["\u043a", "k"], ["\u0443", "y"], ["\u03b1", "a"], ["\u03bf", "o"], ["\u03c1", "p"],
]);
function normalize(value) {
  return [...value.replace(/[\u0110\u0111]/g, "d").replace(/[\u0141\u0142]/g, "l").replace(/\u00f8/gi, "o")
    .normalize("NFKD").toLowerCase().replace(/[\p{M}\p{Cf}]/gu, "")]
    .map(letter => confusables.get(letter) || letter).join("");
}

const escapeRegex = value => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function buildPattern(term, unsegmented = false) {
  const letters = normalize(term).replace(/[^\p{L}\p{N}]/gu, "").replace(/(.)\1+/gu, "$1");
  const body = [...letters].map(letter => `(?:${escapeRegex(letter)}+|[*#]{1,3})`).join(" *");
  return new RegExp(unsegmented ? body : `(?:^|[ *#])${body}(?:s|es|ka|mo|ko|na|ng|nyo|namin|ninyo)?[0-9]*(?=$|[ *#])`, "u");
}

const patterns = [...new Set(Object.values(petTextBlacklist).flat())].map(term => buildPattern(term));
patterns.push(...unsegmentedPetTextBlacklist.map(term => buildPattern(term, true)));
const leetCharacters = /[0123456789@$!|]/g;
function foldLeet(value, one = "i") {
  const map = { 0: "o", 1: one, 2: "z", 3: "e", 4: "a", 5: "s", 6: "g", 7: "t", 8: "b", 9: "g", "@": "a", "$": "s", "!": "i", "|": "i" };
  return value.replace(leetCharacters, character => map[character]);
}

export function containsInappropriateText(value) {
  if (typeof value !== "string" || !value) return false;
  const plain = normalize(value);
  const withoutNumericSuffix = plain.replace(/[0-9]+(?=$|[^\p{L}\p{N}])/gu, "");
  const candidates = [...new Set([plain, withoutNumericSuffix, foldLeet(plain), foldLeet(plain, "l"), foldLeet(withoutNumericSuffix), foldLeet(withoutNumericSuffix, "l")]
    .map(candidate => candidate.replace(/[^\p{L}\p{N}*#]/gu, " ").replace(/ +/g, " ")))];
  return patterns.some(pattern => candidates.some(candidate => pattern.test(candidate)));
}

// Email, passwords, OTPs, URLs, phone numbers, dates and opaque IDs are not
// prose fields and are intentionally excluded from moderation.
export const ACCOUNT_TEXT_FIELDS = { fullName: "Full name", name: "Name", username: "Username" };
export const PROMO_TEXT_FIELDS = { title: "Promo title", description: "Promo description" };
export const PET_TEXT_FIELDS = { petName: "Pet name", breed: "Breed", customBreed: "Breed", notes: "Notes" };
export const APPOINTMENT_TEXT_FIELDS = { petName: "Pet name", notes: "Appointment notes", "decision.reason": "Reason", rejectionReason: "Reason", cancellationReason: "Reason" };
export const EMPLOYEE_TEXT_FIELDS = { fullName: "Full name", name: "Name", username: "Username", fraudReason: "Reason" };
export const MODERATION_ERROR_MESSAGE = "Please remove inappropriate or offensive language before continuing.";
const MAX_MODERATION_TEXT_LENGTH = 5000;

function fieldValue(record, path) {
  return path.split(".").reduce((value, key) => value?.[key], record);
}

export function getTextValidationErrors(record = {}, fields = {}) {
  const errors = {};
  for (const [field, config] of Object.entries(fields)) {
    const value = fieldValue(record, field);
    if (value === undefined || value === null || value === "") continue;
    const label = typeof config === "string" ? config : config.label;
    if (typeof value !== "string") { errors[field] = `${label} must be text.`; continue; }
    if (value.length > MAX_MODERATION_TEXT_LENGTH) { errors[field] = `${label} must be ${MAX_MODERATION_TEXT_LENGTH} characters or fewer.`; continue; }
    if (containsInappropriateText(value)) errors[field] = MODERATION_ERROR_MESSAGE;
  }
  return errors;
}

export function assertAppropriateText(record, fields) {
  const errors = getTextValidationErrors(record, fields);
  if (Object.keys(errors).length) throw Object.assign(new Error(Object.values(errors)[0]), { code: "INVALID_TEXT", fields: errors });
}
