export const PH_MOBILE_ERROR = "Enter a Philippine mobile number: +63 followed by 10 digits starting with 9, or 11 digits starting with 09.";

export function normalizePhilippineMobileNumber(value = "") {
  if (typeof value !== "string") return "";
  const compact = value.trim().replace(/[\s-]/g, "");
  const match = /^(?:\+?63|0)?(9\d{9})$/.exec(compact);
  return match ? `+63 ${match[1]}` : "";
}

export function getPhoneSubscriberInput(value = "") {
  const compact = String(value).trim().replace(/[\s-]/g, "");
  if (compact.startsWith("+63")) return compact.slice(3);
  if (compact.startsWith("63")) return compact.slice(2);
  if (compact.startsWith("0")) return compact.slice(1);
  return compact;
}
