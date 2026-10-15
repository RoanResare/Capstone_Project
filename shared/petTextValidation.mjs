// Keep matching separate from display: reject inappropriate text without silently
// changing a customer's pet name or clinical notes.
const blockedTerms = [
  "fuck", "fucker", "fucking", "motherfucker", "shit", "shitty", "bullshit",
  "bitch", "bitches", "bastard", "asshole", "cunt", "dick", "pussy",
  "porn", "pornography", "nigger", "nigga", "faggot", "fag", "chink", "kike", "spic",
  "puta", "putangina", "putanginamo", "tangina", "tanginamo", "tanginaka",
  "tanginanyo", "tanginaniyo", "tanginamong", "tanginang", "tangena", "taena", "taenamo", "taenaka",
  "gago", "gaga", "tanga", "bobo", "gagoka", "boboka", "ulolka",
  "whore", "slut", "retard", "retarded", "wetback", "raghead", "sandnigger",
  "ulol", "tarantado", "pakshit", "pakyu", "kantot", "iyot", "burat", "tite", "pekpek",
];
const patterns = blockedTerms.map(term => new RegExp(
  `(?:^|[^a-z0-9])${[...term].map(letter => `(?:${letter}+|[*#])`).join("[^a-z0-9*#]*")}(?:s|es)?[0-9]*(?=$|[^a-z0-9])`, "u",
));

export function containsInappropriatePetText(value) {
  if (typeof value !== "string") return false;
  const plain = value.normalize("NFKD").toLowerCase().replace(/[\p{M}\p{Cf}]/gu, "");
  const normalized = plain.replace(/[013457@$!|]/g, character => ({ 0: "o", 1: "i", 3: "e", 4: "a", 5: "s", 7: "t", "@": "a", "$": "s", "!": "i", "|": "i" })[character]);
  return patterns.some(pattern => pattern.test(plain) || pattern.test(normalized))
    || /(?:^|[^a-z0-9])(?:f[u*]ck|sh[i*]t|b[i*]tch)(?=$|[^a-z0-9])/u.test(normalized);
}

export function getPetTextErrors(record = {}) {
  const errors = {};
  for (const [field, label, limit] of [["petName", "Pet name", 60], ["notes", "Notes", 500]]) {
    const value = record[field] ?? "";
    if (typeof value !== "string") errors[field] = `${label} must be text.`;
    else if (field === "petName" && !value.trim()) errors[field] = "Pet name is required.";
    else if (value.length > limit) errors[field] = `${label} must be ${limit} characters or fewer.`;
    else if (containsInappropriatePetText(value)) errors[field] = `${label} contains inappropriate language. Please use respectful wording.`;
  }
  return errors;
}

export function assertAppropriatePetText(record) {
  const errors = getPetTextErrors(record);
  if (Object.keys(errors).length) {
    throw Object.assign(new Error(Object.values(errors)[0]), { code: "INVALID_PET_TEXT", fields: errors });
  }
}
