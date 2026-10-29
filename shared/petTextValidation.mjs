import { containsInappropriateText } from './textModeration.mjs';
export { containsInappropriateText as containsInappropriatePetText } from './textModeration.mjs';

export function getPetTextErrors(record = {}) {
  const errors = {};
  for (const [field, label, limit] of [["petName", "Pet name", 60], ["notes", "Notes", 500]]) {
    const value = record[field] ?? "";
    if (typeof value !== "string") errors[field] = `${label} must be text.`;
    else if (field === "petName" && !value.trim()) errors[field] = "Pet name is required.";
    else if (value.length > limit) errors[field] = `${label} must be ${limit} characters or fewer.`;
    else if (containsInappropriateText(value)) errors[field] = `${label} contains inappropriate language. Please use respectful wording.`;
  }
  return errors;
}

export function assertAppropriatePetText(record) {
  const errors = getPetTextErrors(record);
  if (Object.keys(errors).length) {
    throw Object.assign(new Error(Object.values(errors)[0]), { code: "INVALID_PET_TEXT", fields: errors });
  }
}
