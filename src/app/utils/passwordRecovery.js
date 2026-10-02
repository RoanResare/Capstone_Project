const EMAIL_PATTERN = /^[^\s@]+@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*\.com$/i;

export function getPasswordRecoveryEmailError(value = "") {
  const identifier = typeof value === "string" ? value.trim() : "";

  if (!identifier) {
    return "Email address is required.";
  }

  if (
    identifier.length <= 254 &&
    EMAIL_PATTERN.test(identifier) &&
    !identifier.includes("..") &&
    !identifier.startsWith(".") &&
    !identifier.endsWith(".")
  ) {
    return "";
  }

  return "Enter a valid .com email address, such as name@example.com.";
}

export function isValidPasswordRecoveryEmail(value = "") {
  return !getPasswordRecoveryEmailError(value);
}
