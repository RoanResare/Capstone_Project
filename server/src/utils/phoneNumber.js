const PH_MOBILE_ERROR = "Enter a Philippine mobile number: +63 followed by 10 digits starting with 9, or 11 digits starting with 09.";

function normalizePhilippineMobileNumber(value = "") {
  if (typeof value !== "string") return "";
  const compact = value.trim().replace(/[\s-]/g, "");
  const match = /^(?:\+?63|0)?(9\d{9})$/.exec(compact);
  return match ? `+63 ${match[1]}` : "";
}

module.exports = { PH_MOBILE_ERROR, normalizePhilippineMobileNumber };
