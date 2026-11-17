const WEEKEND_DAYS = [0, 6];

export const SERVICE_OPERATING_DAYS = Object.freeze({
  vaccination: WEEKEND_DAYS,
  deworming: WEEKEND_DAYS,
  consultation: WEEKEND_DAYS,
  "laboratory-testing": WEEKEND_DAYS,
  "low-cost-kapon": WEEKEND_DAYS,
  "pet-grooming": null,
});

export function getClinicWeekday(dateKey = "") {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateKey));
  if (!match) return null;
  const [, year, month, day] = match;
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  if (date.getUTCFullYear() !== Number(year) || date.getUTCMonth() !== Number(month) - 1 || date.getUTCDate() !== Number(day)) return null;
  return date.getUTCDay();
}

export function isValidClinicDateKey(dateKey = "") {
  return getClinicWeekday(dateKey) !== null;
}

export function isServiceAvailableOnDate(serviceId = "", dateKey = "") {
  const allowedDays = SERVICE_OPERATING_DAYS[serviceId];
  if (!(serviceId in SERVICE_OPERATING_DAYS) || !dateKey) return true;
  if (allowedDays === null) return true;
  const weekday = getClinicWeekday(dateKey);
  return weekday !== null && allowedDays.includes(weekday);
}

export function getServiceUnavailableMessage(serviceId, dateKey) {
  if (isServiceAvailableOnDate(serviceId, dateKey)) return "";
  const names = {
    vaccination: "Vaccination",
    deworming: "Deworming",
    consultation: "Veterinary Services",
    "laboratory-testing": "Laboratory Testing",
    "low-cost-kapon": "Low Cost Kapon",
    "pet-grooming": "Pet Grooming",
  };
  const serviceName = names[serviceId] || serviceId;
  if (SERVICE_OPERATING_DAYS[serviceId]?.length) {
    return `${serviceName} is not available on weekdays. Please remove this service or choose an available booking date.`;
  }
  return `${serviceName} is unavailable on the selected booking date.`;
}

export function getUnavailableServiceIds(serviceIds = [], dateKey = "") {
  return serviceIds.filter((serviceId) => !isServiceAvailableOnDate(serviceId, dateKey));
}
