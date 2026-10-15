export const KAPON_SERVICE_ID = "low-cost-kapon";
export const KAPON_UNAVAILABLE_MESSAGE = "Low-Cost Kapon is currently unavailable. Please wait for the next promotion.";

export function isGoogleFormLink(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.port) return false;
    if (url.hostname === "forms.gle") return /^\/[A-Za-z0-9_-]+\/?$/.test(url.pathname);
    if (url.hostname === "docs.google.com") return /^\/forms\/(?:d|u)\/.+/.test(url.pathname);
    return url.hostname === "forms.google.com" && url.pathname.length > 1;
  } catch {
    return false;
  }
}

export function normalizePromoInput(input = {}) {
  assertAppropriateText(input, PROMO_TEXT_FIELDS);
  const title = typeof input.title === "string" ? input.title.trim() : "";
  const description = typeof input.description === "string" ? input.description.trim() : "";
  const formLink = typeof input.formLink === "string" ? input.formLink.trim() : "";
  if (formLink.length > 2048 || !isGoogleFormLink(formLink)) throw new Error("Enter a valid HTTPS Google Form registration link.");
  if (title.length > 100) throw new Error("Promo title must not exceed 100 characters.");
  if (description.length > 1000) throw new Error("Promo description must not exceed 1,000 characters.");
  const parseTime = (value, label) => {
    if (value == null || value === "") return null;
    if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) {
      throw new Error(`${label} must be a valid date and time.`);
    }
    return new Date(value).toISOString();
  };
  const startsAt = parseTime(input.startsAt, "Start time");
  const endsAt = parseTime(input.endsAt, "End time");
  if (startsAt && endsAt && startsAt >= endsAt) throw new Error("End time must be later than start time.");
  return { title: title || "Low-Cost Kapon", description, formLink, startsAt, endsAt };
}

export function isKaponPromoAvailable(promo, now = Date.now()) {
  if (promo?.isActive !== true || !isGoogleFormLink(promo.formLink)) return false;
  const start = promo.startsAt ? Date.parse(promo.startsAt) : null;
  const end = promo.endsAt ? Date.parse(promo.endsAt) : null;
  if ((start !== null && !Number.isFinite(start)) || (end !== null && !Number.isFinite(end))) return false;
  return (start === null || start <= now) && (end === null || now < end);
}

export function isLowCostKaponAppointment(appointment) {
  const matches = (value) => typeof value === "string" &&
    value.toLowerCase().replace(/[^a-z0-9]/g, "") === "lowcostkapon";
  return matches(appointment?.serviceId) || matches(appointment?.service) ||
    (Array.isArray(appointment?.serviceIds) && appointment.serviceIds.some(matches));
}
import { assertAppropriateText, PROMO_TEXT_FIELDS } from "./textModeration.mjs";

