import assert from "node:assert/strict";
import { after, test } from "node:test";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { createServer } from "vite";

const state = { auth: { currentUser: { uid: "customer", role: "customer", email: "customer@example.com" }, isAuthenticated: true, isLoading: false },
  app: { state: { appointments: [], petRecords: [{ id: "pet", customerId: "customer", petName: "Pet", petType: "Dog" }] }, visibleNotifications: [] },
  listener: null, onError: null, stopped: false, requests: [] };
globalThis.__kaponTest = state;
const mocks = {
  "context/AuthContext.jsx": "export const useAuth = () => globalThis.__kaponTest.auth;",
  "context/AppContext.jsx": "export const useApp = () => globalThis.__kaponTest.app;",
  "context/ToastContext.jsx": "export const useToast = () => ({ error() {}, success() {} });",
  "services/customerAccount.js": "export async function changeCustomerPassword() {}",
  "firebase.js": "export const auth = { currentUser: { getIdToken: async () => 'token' } }, db = {}, isFirebaseConfigured = true;",
  "apiClient.js": `export const apiClient = { put: async (...args) => { globalThis.__kaponTest.requests.push(args); return {data: {promo: args[1]}}; } };
    export const buildAuthHeaders = token => ({Authorization: 'Bearer ' + token});
    export const extractApiError = error => error.message;`,
  "firebase/firestore": `export const doc = (db, collection, id) => ({collection, id});
    export function onSnapshot(ref, options, next, error) { globalThis.__kaponTest.listener = next; globalThis.__kaponTest.onError = error;
      return () => { globalThis.__kaponTest.stopped = true; }; }`,
};
const server = await createServer({ configFile: false, server: { middlewareMode: true }, appType: "custom", logLevel: "silent",
  ssr: { noExternal: ["firebase"] },
  plugins: [{ name: "kapon-test-context", enforce: "pre",
    resolveId(source) {
      const key = Object.keys(mocks).find((key) => source === key || source.endsWith(`/${key}`));
      if (key) return `\0kapon-test:${key}`;
    },
    load(id) { if (id.startsWith("\0kapon-test:")) return mocks[id.slice("\0kapon-test:".length)]; },
    transform(code, id) {
      if (id.replaceAll("\\", "/").endsWith("/components/CustomerProfile.jsx")) return code.replace('useState("overview")', 'useState("services")');
      if (id.replaceAll("\\", "/").endsWith("/components/AppointmentBooking.jsx")) return code.replace('petRecordId: "",', 'petRecordId: "pet",');
    },
  }],
});
after(async () => { await server.close(); delete globalThis.__kaponTest; });
const { CustomerProfile } = await server.ssrLoadModule("/src/app/components/CustomerProfile.jsx");
const { AppointmentBooking } = await server.ssrLoadModule("/src/app/components/AppointmentBooking.jsx");
const { KaponPromoManager } = await server.ssrLoadModule("/src/app/components/portal/KaponPromoManager.jsx");
const service = await server.ssrLoadModule("/src/app/services/kaponPromo.js");
const render = (Component, props) => renderToString(createElement(MemoryRouter, null, createElement(Component, props)));
const promo = { isActive: true, title: "Low-Cost Kapon", formLink: "https://forms.gle/example123", description: "Limited slots" };

test("catalog preserves kapon information but only enables booking and shows the banner when active", () => {
  for (const active of [false, true]) {
    Object.assign(state.app, { kaponPromoReady: true, kaponPromoAvailable: active, kaponPromo: active ? promo : null });
    const html = render(CustomerProfile);
    const cards = [...html.matchAll(/<article\b[^>]*>([\s\S]*?)<\/article>/g)].map((match) => match[1]);
    const kaponCard = cards.find((card) => card.includes("Low Cost Kapon"));
    assert.ok(kaponCard.includes("PHP 200 - 2,200"));
    assert.ok(kaponCard.includes("Affordable spay and neuter program"));
    assert.equal(/<button[^>]*disabled=""/.test(kaponCard), !active);
    assert.equal(html.includes("REGISTER NOW"), active);
    if (active) assert.ok(html.includes(`href="${promo.formLink}"`));
    for (const card of cards.filter((card) => !card.includes("Low Cost Kapon"))) assert.ok(!/<button[^>]*disabled=""/.test(card));
  }
  state.app.kaponPromo = { ...promo, formLink: "https://forms.gle/newLink123" };
  assert.ok(render(CustomerProfile).includes('href="https://forms.gle/newLink123"'));
});

test("booking selector disables only kapon when promo information is inactive or loading", () => {
  // Carry a saved pet into the initial state to render the existing service selector.
  for (const available of [false, true]) {
    state.app.kaponPromoAvailable = available;
    const html = render(AppointmentBooking, { embedded: true });
    const kaponOption = html.match(/<option[^>]*value="low-cost-kapon"[^>]*>/)[0];
    assert.equal(kaponOption.includes('disabled=""'), !available);
    assert.ok(!html.match(/<option[^>]*value="vaccination"[^>]*>/)[0].includes('disabled=""'));
  }
});

test("admin controls distinguish inactive, active and unavailable promo data", () => {
  Object.assign(state.app, { kaponPromoReady: true, kaponPromo: null, kaponPromoAvailable: false });
  assert.ok(render(KaponPromoManager).includes("Activate Low-Cost Kapon"));
  Object.assign(state.app, { kaponPromo: promo, kaponPromoAvailable: true });
  const active = render(KaponPromoManager);
  assert.ok(active.includes("Edit Promo") && active.includes("Deactivate"));
  state.app.kaponPromoReady = false;
  assert.ok(render(KaponPromoManager).includes('disabled=""'));
});

test("subscription streams activation, link edits and deactivation, ignores cached state and cleans up", () => {
  const changes = [];
  let error;
  const stop = service.subscribeKaponPromo((value) => changes.push(value), (value) => { error = value; });
  state.listener({ metadata: { fromCache: true }, exists: () => true, data: () => promo });
  assert.equal(changes.length, 0);
  for (const value of [null, promo, { ...promo, formLink: "https://forms.gle/newLink123" }, { isActive: false, revision: 3 }]) {
    state.listener({ metadata: { fromCache: false }, exists: () => Boolean(value), data: () => value });
  }
  assert.equal(changes.length, 4);
  assert.equal(changes[2].formLink, "https://forms.gle/newLink123");
  assert.equal(changes[3].isActive, false);
  state.onError({ code: "permission-denied" });
  assert.match(error.message, /Firestore rules/);
  stop();
  assert.ok(state.stopped);
});

test("promo writes use authenticated backend requests", async () => {
  await service.saveKaponPromo({ ...promo, action: "activate", expectedRevision: 0 });
  const [url, body, options] = state.requests.at(-1);
  assert.equal(url, "/auth/promotions/low-cost-kapon");
  assert.equal(body.formLink, promo.formLink);
  assert.equal(options.headers.Authorization, "Bearer token");
});
