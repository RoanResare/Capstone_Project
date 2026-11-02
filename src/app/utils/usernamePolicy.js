import policy from "../../../shared/usernamePolicy.json" with { type: "json" };

const USERNAME_PATTERN = new RegExp(`^[${policy.allowedCharacters}]{${policy.minLength},${policy.maxLength}}$`);
const INVALID_USERNAME_CHARACTERS = new RegExp(`[^${policy.allowedCharacters}]`, "g");

export const USERNAME_POLICY_MESSAGE = policy.message;
export const USERNAME_MAX_LENGTH = policy.maxLength;
export const USERNAME_INPUT_PATTERN = `[${policy.allowedCharacters.replace("a-z", "A-Za-z")}]` +
  `{${policy.minLength},${policy.maxLength}}`;

export function normalizeUsername(username = "") {
  return typeof username === "string" ? username.trim().toLowerCase() : "";
}

export function isValidUsername(username = "") {
  return USERNAME_PATTERN.test(normalizeUsername(username));
}

export function sanitizeUsernameCandidate(username = "") {
  return normalizeUsername(username)
    .replace(INVALID_USERNAME_CHARACTERS, "")
    .replace(/^[._-]+/, "")
    .slice(0, USERNAME_MAX_LENGTH);
}
