import assert from "node:assert/strict";
import test from "node:test";
import { isGoogleFormLink, normalizePromoInput, isKaponPromoAvailable, isLowCostKaponAppointment, validatePromoStart } from "../shared/lowCostKaponPromo.mjs";

const formLink = "https://forms.gle/example123";
test("only HTTPS Google Form links can activate the promotion", () => {
  for (const link of [formLink, "https://docs.google.com/forms/d/e/example/viewform"]) assert.ok(isGoogleFormLink(link));
  for (const link of ["", "invalid", "http://forms.gle/example", "https://example.com/form", "https://forms.gle.evil.com/a", "javascript:alert(1)", "https://user:pass@forms.gle/example", "https://docs.google.com/document/d/example"]) {
    assert.equal(isGoogleFormLink(link), false, link);
    assert.throws(() => normalizePromoInput({ formLink: link }), /HTTPS Google Form/);
  }
  assert.equal(normalizePromoInput({ formLink }).title, "Low-Cost Kapon");
});

test("missing, inactive and out-of-window promos never allow bookings", () => {
  const now = Date.parse("2030-01-01T12:00:00Z");
  for (const promo of [null, {}, { isActive: false, formLink }, { isActive: true, formLink: "https://invalid.example" },
    { isActive: true, formLink, startsAt: "2030-01-02T00:00:00Z" },
    { isActive: true, formLink, endsAt: "2030-01-01T12:00:00Z" },
    { isActive: true, formLink, endsAt: "invalid" }]) assert.equal(isKaponPromoAvailable(promo, now), false);
  assert.ok(isKaponPromoAvailable({ isActive: true, formLink }, now));
  assert.ok(isKaponPromoAvailable({ isActive: true, formLink, startsAt: "2030-01-01T12:00:00Z", endsAt: "2030-01-02T00:00:00Z" }, now));
  assert.throws(() => normalizePromoInput({ formLink, startsAt: "2030-01-02", endsAt: "2030-01-01" }), /later/);
});

test("service detection catches IDs and name variants without affecting other services", () => {
  for (const appointment of [{ serviceId: "low-cost-kapon" }, { service: "Low Cost Kapon" },
    { serviceId: "vaccination", service: "Low-Cost Kapon" }, { serviceIds: ["vaccination", "low-cost-kapon"] }]) {
    assert.ok(isLowCostKaponAppointment(appointment));
  }
  assert.equal(isLowCostKaponAppointment({ serviceId: "vaccination", service: "Vaccination" }), false);
});

test("promo starts allow the current minute and future times, reject past changes, and preserve an existing start", () => {
  const now = Date.parse("2030-01-01T12:00:45Z");
  assert.doesNotThrow(() => validatePromoStart("2030-01-01T12:00:00Z", { now }));
  assert.doesNotThrow(() => validatePromoStart("2030-01-01T12:01:00Z", { now }));
  assert.throws(() => validatePromoStart("2030-01-01T11:59:00Z", { now }), /current time or later/);
  assert.doesNotThrow(() => validatePromoStart(null, { now }));
  assert.doesNotThrow(() => validatePromoStart("2029-01-01T12:00:00Z", { now, previousStartsAt: "2029-01-01T12:00:00Z" }));
});
