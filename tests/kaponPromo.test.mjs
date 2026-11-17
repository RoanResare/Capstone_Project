import assert from "node:assert/strict";
import test from "node:test";
import { isGoogleFormLink, normalizePromoInput, isKaponPromoAvailable, isLowCostKaponAppointment, validatePromoStart, validatePromoSchedule, getPromoStatus } from "../shared/lowCostKaponPromo.mjs";

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
  assert.throws(() => normalizePromoInput({ formLink, startsAt: "2030-01-02T00:00:00Z", endsAt: "2030-01-01T00:00:00Z" }), /later/);
});

test("service detection catches IDs and name variants without affecting other services", () => {
  for (const appointment of [{ serviceId: "low-cost-kapon" }, { service: "Low Cost Kapon" },
    { serviceId: "vaccination", service: "Low-Cost Kapon" }, { serviceIds: ["vaccination", "low-cost-kapon"] }]) {
    assert.ok(isLowCostKaponAppointment(appointment));
  }
  assert.equal(isLowCostKaponAppointment({ serviceId: "vaccination", service: "Vaccination" }), false);
});

test("24-hour boundary is exact and legacy starts remain unchanged", () => {
  const now = Date.parse("2030-01-01T12:00:45Z");
  for (const delta of [-86400000, 0, 3600000, 86399999]) assert.throws(() => validatePromoStart(new Date(now + delta).toISOString(), { now }), /24 hours/);
  for (const delta of [86400000, 86400001, 172800000]) assert.doesNotThrow(() => validatePromoStart(new Date(now + delta).toISOString(), { now }));
  assert.throws(() => validatePromoStart(null, { now }), /required/);
  assert.doesNotThrow(() => validatePromoStart("2029-01-01T12:00:00Z", { now, previousStartsAt: "2029-01-01T12:00:00Z" }));
});
test("required timezone-aware schedules, ordering, calendar rollover and effective transitions", () => {
  const now = Date.parse("2030-01-30T04:00:00Z");
  const config = normalizePromoInput({ formLink, startsAt: "2030-01-31T12:00:00+08:00", endsAt: "2030-02-01T12:00:00+08:00" });
  validatePromoSchedule(config, { now });
  for (const patch of [{startsAt:null}, {endsAt:null}, {endsAt:config.startsAt}, {endsAt:"2030-01-30T12:00:00Z"}]) assert.throws(() => validatePromoSchedule({...config,...patch},{now}));
  for (const startsAt of ["invalid", "2030-01-31", "2030-02-30T12:00:00Z", "2030-01-31T12:00"]) assert.throws(() => normalizePromoInput({formLink,startsAt}));
  const promo = {...config,isActive:true};
  const start = Date.parse(config.startsAt), end = Date.parse(config.endsAt);
  assert.equal(getPromoStatus(promo,start-1),"Scheduled");
  assert.equal(getPromoStatus(promo,start),"Active");
  assert.equal(getPromoStatus(promo,end),"Expired");
  assert.equal(isKaponPromoAvailable(promo,start-1),false);
  assert.equal(isKaponPromoAvailable(promo,start),true);
  assert.equal(isKaponPromoAvailable(promo,end),false);
});

test("text-only edits preserve legacy schedules but changing either boundary requires full validation", () => {
  const now=Date.parse("2030-01-01T00:00:00Z");
  const previous={startsAt:"2029-01-01T00:00:00.123Z",endsAt:"2029-01-01T02:00:00.456Z"};
  assert.doesNotThrow(()=>validatePromoSchedule(previous,{now,previous}));
  assert.doesNotThrow(()=>validatePromoSchedule({startsAt:null,endsAt:null},{now,previous:{}}));
  assert.throws(()=>validatePromoSchedule({...previous,endsAt:"2030-01-03T00:00:00Z"},{now,previous}),/24 hours/);
});
