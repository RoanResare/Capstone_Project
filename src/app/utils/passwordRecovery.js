import { isValidEmail, ILLEGITIMATE_EMAIL_ERROR } from "./emailValidation.js";

export function getPasswordRecoveryEmailError(value = "") {
  const identifier = typeof value === "string" ? value.trim() : "";

  if (!identifier) {
    return "Email address is required.";
  }

  if (isValidEmail(identifier)) {
    return "";
  }

  return ILLEGITIMATE_EMAIL_ERROR;
}

export function isValidPasswordRecoveryEmail(value = "") {
  return !getPasswordRecoveryEmailError(value);
}
