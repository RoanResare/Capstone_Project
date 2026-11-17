import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const indexHtml = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const robots = readFileSync(new URL("../public/robots.txt", import.meta.url), "utf8");
const sitemap = readFileSync(new URL("../public/sitemap.xml", import.meta.url), "utf8");
const layout = readFileSync(new URL("../src/app/components/Layout.jsx", import.meta.url), "utf8");
const about = readFileSync(new URL("../src/app/components/About.jsx", import.meta.url), "utf8");
const backendPrompt = readFileSync(new URL("../server/src/services/groq.service.js", import.meta.url), "utf8");
const vitePrompt = readFileSync(new URL("../vite.config.js", import.meta.url), "utf8");

test("homepage metadata and JSON-LD describe the supplied business details", () => {
  assert.match(indexHtml, /<title>Charming Fur-fection Pet Care Services \| Las Piñas City<\/title>/);
  assert.match(indexHtml, /name="description" content="Official website of Charming Fur-fection/);
  assert.match(indexHtml, /rel="canonical" href="https:\/\/www\.charmingfurfectionpetscareservices\.online\/"/);
  assert.match(indexHtml, /property="og:type" content="website"/);
  const match = indexHtml.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
  assert.ok(match, "expected a JSON-LD block");
  const schema = JSON.parse(match[1]);
  assert.equal(schema["@type"], "LocalBusiness");
  assert.equal(schema.name, "Charming Fur-fection Pet Care Services");
  assert.equal(schema.url, "https://www.charmingfurfectionpetscareservices.online/");
  assert.equal(schema.telephone, "+639502511754");
  assert.equal(schema.address.addressLocality, "Las Piñas City");
  assert.equal(schema.address.addressCountry, "PH");
  assert.equal(schema.openingHoursSpecification, undefined, "distinct service hours are not flattened into one opening schedule");
  assert.equal(schema.sameAs, undefined, "no unconfirmed social profiles are listed");
  assert.doesNotMatch(indexHtml, /aggregateRating|reviewCount|VeterinaryHospital/);
});

test("route metadata indexes only public business pages and canonicalizes query-free URLs", () => {
  assert.match(layout, /"\/":\s*\{/);
  assert.match(layout, /"\/about":\s*\{/);
  assert.match(layout, /noindex,nofollow/);
  assert.match(layout, /const routePath = location\.pathname === "\/" \? "\/" : location\.pathname\.replace/);
  assert.match(layout, /const canonicalUrl = `\$\{canonicalOrigin\}\$\{routePath\}`/);
  assert.match(about, /This is the official website of Charming Fur-fection Pet Care Services in Las Piñas City/);
  assert.match(about, /developed for the business and is used by the client for its operations/);
});

test("robots and sitemap publish only crawlable business pages and exclude private app routes", () => {
  assert.match(robots, /^User-agent: \*/m);
  assert.match(robots, /Sitemap: https:\/\/www\.charmingfurfectionpetscareservices\.online\/sitemap\.xml/);
  for (const route of ["/api/", "/customer/", "/portal/", "/admin/", "/staff/", "/verify-otp"]) {
    assert.ok(robots.includes(`Disallow: ${route}`), `expected robots exclusion for ${route}`);
  }
  assert.match(sitemap, /<loc>https:\/\/www\.charmingfurfectionpetscareservices\.online\/<\/loc>/);
  assert.match(sitemap, /<loc>https:\/\/www\.charmingfurfectionpetscareservices\.online\/about<\/loc>/);
  assert.doesNotMatch(sitemap, /customer|portal|admin|staff|appointment|api/i);
  assert.equal(sitemap.includes("www.charmingfurfectionpetscareservices.online"), true);
});

test("production and local Groq prompts share official-site and third-party caution", () => {
  for (const prompt of [backendPrompt, vitePrompt]) {
    assert.ok(prompt.includes("https://www.charmingfurfectionpetscareservices.online"));
    assert.match(prompt, /do not assume they are official or fake/i);
    assert.match(prompt, /do not call (?:this website|it) fake/i);
    assert.match(prompt, /independent(?:ly)? security verification/i);
    assert.match(prompt, /Do not invent who specifically developed the website|Do not invent a developer name/i);
  }
});
