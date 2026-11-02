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
    const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})(?::(\d{2})(?:\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/.exec(value);
    if (!match) throw new Error(`${label} must include a valid date, time and timezone.`);
    const zone = match[4];
    const offset = zone === "Z" ? 0 : (zone[0] === "+" ? 1 : -1) * (Number(zone.slice(1, 3)) * 60 + Number(zone.slice(4)));
    const local = new Date(Date.parse(value) + offset * 60000).toISOString();
    if (local.slice(0, 16) !== `${match[1]}T${match[2]}` || Number(match[3] || 0) > 59) throw new Error(`${label} must be a valid date and time.`);
    return new Date(value).toISOString();
  };
  const startsAt = parseTime(input.startsAt, "Start time");
  const endsAt = parseTime(input.endsAt, "End time");
  if (startsAt && endsAt && startsAt >= endsAt) throw new Error("End time must be later than start time.");
  return { title: title || "Low-Cost Kapon", description, formLink, startsAt, endsAt };
}

export function promoNow(promo) {
  return Number.isFinite(promo?.serverNow) && Number.isFinite(promo?.clockReceivedAt) ? promo.serverNow + performance.now() - promo.clockReceivedAt : Date.now();
}

export function isKaponPromoAvailable(promo, now = promoNow(promo)) {
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


export const PROMO_NOTICE_MS = 86400000;
export function validatePromoStart(startsAt, { now = Date.now(), previousStartsAt = null } = {}) {
  if (previousStartsAt && Date.parse(startsAt) === Date.parse(previousStartsAt)) return;
  if (!startsAt || !Number.isFinite(Date.parse(startsAt))) throw new Error("Promotion start date and time are required.");
  if (Date.parse(startsAt) < now + PROMO_NOTICE_MS) throw new Error("Schedule the promotion at least 24 hours in advance.");
}
export function validatePromoSchedule(config, { now = Date.now(), previous = null } = {}) {
  if (previous && config.startsAt === (previous.startsAt || null) && config.endsAt === (previous.endsAt || null)) return;
  if (!config.startsAt || !config.endsAt) throw new Error("Promotion start and end date and time are required.");
  validatePromoStart(config.startsAt, { now });
  if (Date.parse(config.endsAt) <= Date.parse(config.startsAt)) throw new Error("End time must be later than start time.");
}
export function getPromoStatus(promo, now = promoNow(promo)) {
  if (!promo?.isActive) return "Inactive";
  if (promo.endsAt && Date.parse(promo.endsAt) <= now) return "Expired";
  if (promo.startsAt && Date.parse(promo.startsAt) > now) return "Scheduled";
  return isKaponPromoAvailable(promo, now) ? "Active" : "Unavailable";
}
