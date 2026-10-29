import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { createServer } from "vite";
import tailwindcss from "@tailwindcss/vite";

const { chromium } = await import(process.env.KAPON_PLAYWRIGHT_MODULE
  ? pathToFileURL(process.env.KAPON_PLAYWRIGHT_MODULE).href : "playwright");
const appMock = `
  import { useSyncExternalStore } from 'react';
  import { isKaponPromoAvailable, normalizePromoInput } from '/shared/lowCostKaponPromo.mjs';
  const listeners = new Set();
  let promo = null;
  window.__bookedAppointments = [];
  const base = { state: { appointments: [], petRecords: [{id: 'pet', customerId: 'customer', petName: 'Pet', petType: 'Dog'}] }, visibleNotifications: [], kaponPromoReady: true,
    availabilityReady: true, getPendingAppointmentCount: () => 0, createAppointment: async payload => { window.__bookedAppointments.push(payload); } };
  let snapshot;
  const update = value => { promo = value; snapshot = {...base, kaponPromo: promo, kaponPromoAvailable: isKaponPromoAvailable(promo), manageKaponPromo: save}; listeners.forEach(fn => fn()); };
  async function save(payload) {
    if (payload.expectedRevision !== (promo?.revision || 0)) throw new Error('The promotion was changed by another employee.');
    if (payload.action === 'deactivate') update({isActive: false, revision: (promo?.revision || 0) + 1});
    else update({...normalizePromoInput(payload), isActive: true, revision: (promo?.revision || 0) + 1});
  }
  update(null);
  window.__setKaponPromo = update;
  export const useApp = () => useSyncExternalStore(fn => {listeners.add(fn); return () => listeners.delete(fn);}, () => snapshot);
`;
const mocks = {
  "context/AppContext.jsx": appMock,
  "context/AuthContext.jsx": "export const useAuth = () => ({currentUser: {uid: 'customer', role: 'customer', email: 'customer@example.com', username: 'Customer', status: 'active'}, isAuthenticated: true, isLoading: false});",
  "context/ToastContext.jsx": "export const useToast = () => ({error() {}, success() {}});",
  "services/customerAccount.js": "export async function changeCustomerPassword() {}",
};
const server = await createServer({ configFile: false, server: { host: "127.0.0.1", port: 5198, strictPort: false }, logLevel: "silent",
  plugins: [tailwindcss(), {
    name: "kapon-browser-fixture", enforce: "pre",
    resolveId(source) {
      if (source === "/__kapon_test_entry.js") return "\0kapon-test-entry";
      const key = Object.keys(mocks).find((key) => source.endsWith(`/${key}`));
      if (key) return `\0kapon-mock:${key}`;
    },
    load(id) {
      if (id.startsWith("\0kapon-mock:")) return mocks[id.slice("\0kapon-mock:".length)];
      if (id === "\0kapon-test-entry") return `
        import React from 'react'; import {createRoot} from 'react-dom/client';
        import {MemoryRouter} from 'react-router-dom';
        import {KaponPromoManager} from '/src/app/components/portal/KaponPromoManager.jsx';
        import {CustomerProfile} from '/src/app/components/CustomerProfile.jsx';
        import '/src/styles/index.css';
        createRoot(document.getElementById('root')).render(React.createElement(MemoryRouter, {initialEntries: ['/customer/dashboard?tab=services']},
          React.createElement(React.Fragment, null, React.createElement(KaponPromoManager), React.createElement(CustomerProfile))));
      `;
    },
    configureServer(vite) {
      vite.middlewares.use((req, res, next) => {
        if (req.url !== "/__kapon_test") return next();
        res.setHeader("Content-Type", "text/html");
        res.end('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/__kapon_test_entry.js"></script></body></html>');
      });
    },
  }],
});
let browser;
try {
  await server.listen();
  browser = await chromium.launch({ headless: true });
  const errors = [];
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, timezoneId: "Asia/Manila" });
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`${server.resolvedUrls.local[0]}__kapon_test`);
  const card = page.locator("article").filter({ has: page.getByRole("heading", { name: "Low Cost Kapon", exact: true }) });
  await card.waitFor();
  assert.ok(await card.getByRole("button", { name: "Continue to booking" }).isDisabled());
  await page.getByRole("button", { name: "Activate Low-Cost Kapon", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.waitFor();
  await dialog.getByRole("button", { name: "Activate Promo" }).click();
  await dialog.getByRole("alert").waitFor();
  await dialog.getByLabel("Google Form Registration Link").fill("https://forms.gle/example123");
  await dialog.getByRole("button", { name: "Activate Promo" }).click();
  await dialog.waitFor({ state: "hidden" });
  await page.getByRole("link", { name: "REGISTER NOW" }).waitFor();
  assert.ok(await card.getByRole("button", { name: "Continue to booking" }).isEnabled());
  await page.getByRole("button", { name: "Edit Promo", exact: true }).click();
  await dialog.getByLabel("Google Form Registration Link").fill("https://forms.gle/updated123");
  await dialog.getByRole("button", { name: "Save changes", exact: true }).click();
  await dialog.waitFor({ state: "hidden" });
  assert.equal(await page.getByRole("link", { name: "REGISTER NOW" }).getAttribute("href"), "https://forms.gle/updated123");
  await card.getByRole("button", { name: "Continue to booking" }).click();
  await page.getByRole("button", { name: "Add another service", exact: true }).waitFor();
  await page.getByLabel("Select pet", { exact: true }).selectOption("pet");
  await page.getByRole("button", { name: "Add another service", exact: true }).click();
  const extraService = page.getByLabel("Additional service", { exact: true });
  await extraService.selectOption("vaccination");
  assert.ok(await extraService.locator('option[value="low-cost-kapon"]').isDisabled());
  assert.ok(await extraService.locator('option[value="laboratory-testing"]').isDisabled());
  assert.ok(await page.getByRole("button", { name: "Add another service", exact: true }).isDisabled());
  assert.equal(await page.locator('p').filter({ hasText: /^Pet #1$/ }).count(), 1);
  await page.locator('button').filter({ hasText: /^\d{1,2}$/ }).and(page.locator('button:enabled')).first().click();
  await page.locator('button').filter({ hasText: /openings? left/ }).first().click();
  await page.getByRole("button", { name: "Confirm appointment booking", exact: true }).click();
  await page.waitForFunction(() => window.__bookedAppointments.length === 1);
  const booking = await page.evaluate(() => window.__bookedAppointments[0]);
  assert.deepEqual(booking.serviceIds, ["low-cost-kapon", "vaccination"]);
  assert.equal(booking.estimatedDurationMinutes, 120);
  assert.equal(booking.petRecordIds.length, 1);
  await page.getByLabel("Select pet", { exact: true }).selectOption("pet");
  await page.getByLabel("Selected service", { exact: true }).selectOption("laboratory-testing");
  await page.getByRole("button", { name: "Add another service", exact: true }).click();
  assert.ok(await page.getByLabel("Additional service", { exact: true }).locator('option[value="pet-grooming"]').isDisabled());
  await page.getByRole("button", { name: "Remove additional service", exact: true }).click();
  await page.getByLabel("Selected service", { exact: true }).selectOption("pet-grooming");
  await page.getByRole("button", { name: "Add another service", exact: true }).click();
  assert.ok(await page.getByLabel("Additional service", { exact: true }).locator('option[value="laboratory-testing"]').isDisabled());
  await page.getByLabel("Additional service", { exact: true }).selectOption("vaccination");
  await mkdir("artifacts/kapon-promo", { recursive: true });
  await page.screenshot({ path: "artifacts/kapon-promo/desktop.png", fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: "artifacts/kapon-promo/mobile.png", fullPage: true });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), "Mobile content must fit the viewport");
  await page.getByRole("button", { name: "Edit Promo", exact: true }).click();
  await dialog.waitFor();
  const bounds = await dialog.boundingBox();
  assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= 391);
  await page.screenshot({ path: "artifacts/kapon-promo/mobile-modal.png" });
  await page.keyboard.press("Escape");
  await dialog.waitFor({ state: "hidden" });
  page.once("dialog", (confirmation) => confirmation.accept());
  await page.getByRole("button", { name: "Deactivate", exact: true }).click();
  await page.getByRole("link", { name: "REGISTER NOW" }).waitFor({ state: "hidden" });
  assert.ok(await card.getByRole("button", { name: "Continue to booking" }).isDisabled());
  assert.ok(await page.locator("article").filter({ has: page.getByRole("heading", { name: "Vaccination", exact: true }) }).getByRole("button", { name: "Continue to booking" }).isEnabled());
  assert.deepEqual(errors, []);
  console.log("Browser checks passed: activation, editing, deactivation, invalid link, desktop, mobile and modal focus.");
} finally {
  await browser?.close();
  await server.close();
}
