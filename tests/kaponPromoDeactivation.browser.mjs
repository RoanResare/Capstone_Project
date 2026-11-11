import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { createServer } from "vite";
import tailwindcss from "@tailwindcss/vite";

const { chromium } = await import(process.env.KAPON_PLAYWRIGHT_MODULE
  ? pathToFileURL(process.env.KAPON_PLAYWRIGHT_MODULE).href : "playwright");

const appMock = `
  import { useSyncExternalStore } from 'react';
  const listeners = new Set();
  let promo = {isActive: true, startsAt: '2030-01-01T00:00:00.000Z', endsAt: '2031-01-01T00:00:00.000Z', formLink: 'https://forms.gle/example123', revision: 3};
  let snapshot;
  window.__deactivationCalls = 0;
  window.__holdKaponDeactivate = false;
  window.__toasts = [];
  const publish = () => {
    snapshot = {kaponPromo: promo, kaponPromoReady: true, kaponPromoError: '', manageKaponPromo: save};
    listeners.forEach(listener => listener());
  };
  async function save(payload) {
    if (payload.action !== 'deactivate') throw new Error('Unexpected promotion action');
    window.__deactivationCalls += 1;
    if (window.__holdKaponDeactivate) await new Promise(resolve => { window.__releaseKaponDeactivate = resolve; });
    promo = {...promo, isActive: false, revision: promo.revision + 1};
    publish();
  }
  publish();
  export const useApp = () => useSyncExternalStore(listener => {listeners.add(listener); return () => listeners.delete(listener);}, () => snapshot);
`;

const server = await createServer({
  configFile: false,
  logLevel: "silent",
  resolve: { dedupe: ["react", "react-dom"] },
  optimizeDeps: { include: ["react", "react-dom/client", "lucide-react"] },
  esbuild: { jsx: "automatic" },
  server: { host: "127.0.0.1", port: 0 },
  plugins: [tailwindcss(), {
    name: "kapon-deactivation-fixture",
    enforce: "pre",
    resolveId(source) {
      if (source === "/__kapon_deactivation_entry.js") return "\0kapon-deactivation-entry";
      if (source.endsWith("/context/AppContext.jsx")) return "\0kapon-deactivation-app";
      if (source.endsWith("/context/ToastContext.jsx")) return "\0kapon-deactivation-toast";
    },
    load(id) {
      if (id === "\0kapon-deactivation-app") return appMock;
      if (id === "\0kapon-deactivation-toast") return "export const useToast = () => ({success(message) {window.__toasts.push(['success', message]);}, error(message) {window.__toasts.push(['error', message]);}});";
      if (id === "\0kapon-deactivation-entry") return `
        import React from 'react';
        import {createRoot} from 'react-dom/client';
        import {KaponPromoManager} from '/src/app/components/portal/KaponPromoManager.jsx';
        import '/src/styles/index.css';
        createRoot(document.getElementById('root')).render(React.createElement(KaponPromoManager));
      `;
    },
    configureServer(vite) {
      vite.middlewares.use((req, res, next) => {
        if (req.url !== "/__kapon_deactivation_test") return next();
        res.setHeader("Content-Type", "text/html");
        res.end('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/__kapon_deactivation_entry.js"></script></body></html>');
      });
    },
  }],
});

let browser;
try {
  await server.listen();
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  let nativeDialogCount = 0;
  page.on("pageerror", error => errors.push(error.message));
  page.on("dialog", dialog => { nativeDialogCount += 1; dialog.dismiss(); });
  await page.route("**/*", route => new URL(route.request().url()).hostname === "127.0.0.1" ? route.continue() : route.abort());
  await page.goto(`${server.resolvedUrls.local[0]}__kapon_deactivation_test`, { waitUntil: "domcontentloaded", timeout: 60000 });
  const deactivateButton = page.getByRole("button", { name: "Deactivate", exact: true });
  await deactivateButton.waitFor();
  await deactivateButton.click();

  let dialog = page.getByRole("dialog");
  await dialog.getByRole("heading", { name: "Deactivate Low-Cost Kapon Promo?", exact: true }).waitFor();
  await dialog.getByText("Are you sure you want to deactivate the Low-Cost Kapon promotion? New bookings and registration will become unavailable.", { exact: true }).waitFor();
  const desktopBounds = await dialog.boundingBox();
  assert.ok(desktopBounds.width <= 512 && desktopBounds.x >= 0 && desktopBounds.x + desktopBounds.width <= 1440,
    "The confirmation should fit at desktop width");
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await dialog.waitFor({ state: "hidden" });
  assert.equal(await page.evaluate(() => window.__deactivationCalls), 0, "Cancel must not deactivate the promotion");
  await deactivateButton.click();

  dialog = page.getByRole("dialog");
  await page.setViewportSize({ width: 390, height: 844 });
  const mobileBounds = await dialog.boundingBox();
  assert.ok(mobileBounds.x >= 0 && mobileBounds.x + mobileBounds.width <= 390,
    "The confirmation should fit at mobile width");
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true,
    "The confirmation should not cause horizontal overflow on mobile");
  await page.evaluate(() => { window.__holdKaponDeactivate = true; });
  await dialog.getByRole("button", { name: "Deactivate Promo", exact: true }).click();
  const pendingButton = dialog.getByRole("button", { name: "Deactivating...", exact: true });
  await pendingButton.waitFor();
  assert.equal(await pendingButton.isDisabled(), true, "The confirmation action should disable while processing");
  await pendingButton.evaluate(button => button.click());
  assert.equal(await page.evaluate(() => window.__deactivationCalls), 1,
    "Repeated activation must not submit another deactivation request");
  await page.evaluate(() => { window.__holdKaponDeactivate = false; window.__releaseKaponDeactivate(); });
  await dialog.waitFor({ state: "hidden" });
  assert.equal(await page.evaluate(() => window.__toasts.some(([kind, message]) => kind === "success" && message === "Low-Cost Kapon promotion deactivated.")), true,
    "Successful deactivation should retain the existing success feedback");
  assert.equal(nativeDialogCount, 0, "Deactivation must not use a browser-native confirmation");
  assert.deepEqual(errors, []);
  console.log("PASS: deactivation confirmation, cancel behavior, pending request guard, success feedback, and desktop/mobile layout.");
} finally {
  await browser?.close();
  await server.close();
}
