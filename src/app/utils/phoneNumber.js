export const PH_MOBILE_FORMAT = "+63 900-000-0000";
export const PH_MOBILE_ERROR = `Enter a Philippine mobile number in this format: ${PH_MOBILE_FORMAT}.`;

export function normalizePhilippineMobileNumber(value = "") {
  if (typeof value !== "string") return "";
  const compact = value.trim().replace(/[\s-]/g, "");
  const match = /^(?:\+?63|0)?(9\d{9})$/.exec(compact);
  return match ? `+63 ${match[1]}` : "";
}

export function getPhoneSubscriberInput(value = "") {
  const compact = String(value).replace(/\D/g, "");
  if (compact.startsWith("+63")) return compact.slice(3);
  if (compact.startsWith("63")) return compact.slice(2);
  if (compact.startsWith("0")) return compact.slice(1);
  return compact.slice(0, 10);
}

export function formatPhilippineMobileNumber(value = "") {
  const normalized = normalizePhilippineMobileNumber(value);
  if (!normalized) return "";
  const subscriber = normalized.replace(/\D/g, "").slice(2);
  return `+63 ${subscriber.slice(0, 3)}-${subscriber.slice(3, 6)}-${subscriber.slice(6)}`;
}

export function formatPhilippineMobileInput(value = "") {
  const subscriber = getPhoneSubscriberInput(value).replace(/\D/g, "").slice(0, 10);
  if (!subscriber) return "";
  const first = subscriber.slice(0, 3);
  const second = subscriber.slice(3, 6);
  const third = subscriber.slice(6, 10);
  return `+63 ${[first, second, third].filter(Boolean).join("-")}`;
}
