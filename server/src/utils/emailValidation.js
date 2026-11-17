const { ApiError } = require("./ApiError");
const ILLEGITIMATE_EMAIL_ERROR = "Illegitimate email cannot be verified";
const EMAIL_PATTERN = /^[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+)*@(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z]{2,63}$/;

function isValidEmail(value = "") {
  if (typeof value !== "string") return false;
  const email = value.trim();
  return email.length <= 254 && email.split("@")[0].length <= 64 && EMAIL_PATTERN.test(email);
}

function assertValidEmail(email) {
  if (!isValidEmail(email)) throw new ApiError(400, ILLEGITIMATE_EMAIL_ERROR);
}

module.exports = { ILLEGITIMATE_EMAIL_ERROR, isValidEmail, assertValidEmail };
