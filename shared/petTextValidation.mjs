import { containsInappropriateText, MODERATION_ERROR_MESSAGE } from './textModeration.mjs';
export { containsInappropriateText as containsInappropriatePetText } from './textModeration.mjs';

export function getPetTextErrors(record = {}) {
  const errors = {};
  for (const [field, label, limit] of [["petName", "Pet name", 60], ["breed", "Breed", 100], ["customBreed", "Breed", 60], ["notes", "Notes", 500]]) {
    const value = record[field] ?? "";
    if (typeof value !== "string") errors[field] = `${label} must be text.`;
    else if (field === "petName" && !value.trim()) errors[field] = "Pet name is required.";
    else if (value.length > limit) errors[field] = `${label} must be ${limit} characters or fewer.`;
    else if (containsInappropriateText(value)) errors[field] = MODERATION_ERROR_MESSAGE;
  }
  return errors;
}

export function assertAppropriatePetText(record) {
  const errors = getPetTextErrors(record);
  if (Object.keys(errors).length) {
    throw Object.assign(new Error(Object.values(errors)[0]), { code: "INVALID_PET_TEXT", fields: errors });
  }
}
