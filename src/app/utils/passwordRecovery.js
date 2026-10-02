const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const PHILIPPINE_MOBILE_PATTERN = /^09\d{9}$/;

export function getPasswordRecoveryIdentifierError(value = "") {
  const identifier = typeof value === "string" ? value.trim() : "";

  if (!identifier) {
    return "Email address or phone number is required.";
  }

  if (EMAIL_PATTERN.test(identifier) || PHILIPPINE_MOBILE_PATTERN.test(identifier)) {
    return "";
  }

  return "Enter a valid email address or an 11-digit Philippine mobile number starting with 09.";
}

export function isValidPasswordRecoveryIdentifier(value = "") {
  return !getPasswordRecoveryIdentifierError(value);
}
