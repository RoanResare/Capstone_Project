export const PASSWORD_POLICY_MESSAGE =
  "Password must be at least 6 characters and include an uppercase letter, lowercase letter, and special character.";

export function getPasswordPolicyError(password = "") {
  const value = typeof password === "string" ? password : "";

  if (value.length < 6) return "Password must be at least 6 characters.";
  if (!/[A-Z]/.test(value)) return "Password must include at least one uppercase letter.";
  if (!/[a-z]/.test(value)) return "Password must include at least one lowercase letter.";
  if (!/[^A-Za-z0-9]/.test(value)) {
    return "Password must include at least one special character or symbol.";
  }

  return "";
}

export function isPasswordPolicyValid(password = "") {
  return !getPasswordPolicyError(password);
}
