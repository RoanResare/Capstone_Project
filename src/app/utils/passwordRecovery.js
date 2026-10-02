const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function getPasswordRecoveryEmailError(value = "") {
  const identifier = typeof value === "string" ? value.trim() : "";

  if (!identifier) {
    return "Email address is required.";
  }

  if (identifier.length <= 254 && EMAIL_PATTERN.test(identifier)) {
    return "";
  }

  return "Enter a valid email address, such as name@example.com.";
}

export function isValidPasswordRecoveryEmail(value = "") {
  return !getPasswordRecoveryEmailError(value);
}
