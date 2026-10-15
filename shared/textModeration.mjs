import { petTextBlacklist, unsegmentedPetTextBlacklist } from "./petTextBlacklist.mjs";

// Detection never rewrites the submitted/displayed value. Both the browser and
// API use this module, so policy and normalization cannot diverge.
function normalize(value) {
  // Vietnamese d-stroke is not decomposed by Unicode normalization.
  value = value.replace(/[\u0110\u0111]/g, "d");
  return value.normalize("NFKD").toLowerCase().replace(/[\p{M}\p{Cf}]/gu, "").replace(/đ/g, "d")
    .replace(/[ßłøđðæœ]/gu, letter => ({ "ß": "ss", "ł": "l", "ø": "o", "đ": "d", "ð": "d", "æ": "ae", "œ": "oe" })[letter]);
}

const confusables = { а: "a", е: "e", о: "o", р: "p", с: "c", х: "x", і: "i", ј: "j", к: "k", у: "y", α: "a", ο: "o", ρ: "p" };
const skeleton = value => value.replace(/[аеорсхіјкуαορ]/gu, letter => confusables[letter]);
const escapeRegex = value => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function buildPattern(term, unsegmented = false) {
  // Collapse dictionary double letters first so adjacent repeated-letter
  // groups cannot produce combinatorial backtracking on long hostile input.
  const letters = skeleton(normalize(term)).replace(/[^\p{L}\p{N}]/gu, "").replace(/(.)\1+/gu, "$1");
  // Unicode token boundaries are normalized once per candidate, rather than
  // expanded into hundreds of expensive Unicode character classes per regex.
  const body = [...letters].map(letter => `(?:${escapeRegex(letter)}+|[*#])`).join(" *");
  return new RegExp(unsegmented ? body : `(?:^|[ *#])${body}(?:s|es)?[0-9]*(?=$|[ *#])`, "u");
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
  const plain = skeleton(normalize(value));
  // Keep the plain candidate: punctuation such as a final ! or $ must not
  // become a new letter and accidentally conceal a word boundary.
  const withoutNumericSuffix = plain.replace(/[0-9]+(?=$|[^\p{L}\p{N}])/gu, "");
  const candidates = [...new Set([plain, withoutNumericSuffix, foldLeet(plain), foldLeet(plain, "l"), foldLeet(withoutNumericSuffix), foldLeet(withoutNumericSuffix, "l")]
    .map(candidate => candidate.replace(/[^\p{L}\p{N}*#]/gu, " ").replace(/ +/g, " ")))];
  return patterns.some(pattern => candidates.some(candidate => pattern.test(candidate)));
}


export const ACCOUNT_TEXT_FIELDS = { fullName: 'Full name', name: 'Name', email: { label: 'Email', kind: 'email' }, username: 'Username' };
export const PROMO_TEXT_FIELDS = { title: 'Promo title', description: 'Promo description' };
export const PET_TEXT_FIELDS = { petName: 'Pet name', notes: 'Notes' };

export function getTextValidationErrors(record = {}, fields = {}) {
  const errors = {};
  for (const [field, config] of Object.entries(fields)) {
    const value = record?.[field];
    if (value === undefined || value === null || value === '') continue;
    const label = typeof config === 'string' ? config : config.label;
    if (typeof value !== 'string') { errors[field] = label + ' must be text.'; continue; }
    const candidates = typeof config === 'object' && config.kind === 'email' ? [value, ...value.split('@')] : [value];
    if (candidates.some(containsInappropriateText)) errors[field] = label + ' contains inappropriate language. Please use respectful wording.';
  }
  return errors;
}

export function assertAppropriateText(record, fields) {
  const errors = getTextValidationErrors(record, fields);
  if (Object.keys(errors).length) throw Object.assign(new Error(Object.values(errors)[0]), { code: 'INVALID_TEXT', fields: errors });
}
