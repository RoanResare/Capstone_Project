import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { createServer } from "vite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const { chromium } = await import(process.env.SIGNUP_PLAYWRIGHT_MODULE
  ? pathToFileURL(process.env.SIGNUP_PLAYWRIGHT_MODULE).href : "playwright");
const mocks = {
  "services/supabaseConfig.js": "export const isSupabaseConfigured = true, supabaseUrl = 'https://auth.example', supabaseAnonKey = 'test';",
  "services/supabaseSession.js": `export const auth = {currentUser: null}, supabase = {};
    export const getSupabaseSession = async () => null;
    export const subscribeSupabaseAuth = callback => {callback('INITIAL_SESSION', null); return () => {};};
    export function installSupabaseSession() {} export function loadSupabaseProfile() {}
    export function signOutSupabase() {} export function setSupabaseSessionPersistence() {}
    export function getSupabaseAccessToken() {return '';}`,
  "AuthHeroPanel.jsx": "export function AuthHeroPanel() {return null;}",
  "AuthPageBackdrop.jsx": "export function AuthPageBackdrop() {return null;}",
};
const cacheDir = mkdtempSync(join(tmpdir(), "capstone-signup-test-"));
const server = await createServer({ configFile: false, logLevel: "silent", cacheDir,
  resolve: { dedupe: ["react", "react-dom"] },
  optimizeDeps: { include: ["react", "react-dom/client", "react-router-dom", "motion/react", "lucide-react", "axios"] },
  esbuild: { jsx: "automatic" },
  server: { host: "127.0.0.1", port: 5198 },
  define: { "import.meta.env.VITE_API_URL": JSON.stringify("/api") },
  plugins: [{ name: "signup-browser-fixture", enforce: "pre",
    resolveId(source) {
      if (source === "/__signup_entry.js") return "\0signup-entry";
      const key = Object.keys(mocks).find(key => source.endsWith(`/${key}`));
      if (key) return `\0signup-mock:${key}`;
    },
    load(id) {
      if (id.startsWith("\0signup-mock:")) return mocks[id.slice("\0signup-mock:".length)];
      if (id === "\0signup-entry") return `import React from 'react';
        import {createRoot} from 'react-dom/client';import {MemoryRouter} from 'react-router-dom';
        import {AuthProvider} from '/src/app/context/AuthContext.jsx';
        import {CustomerSignup} from '/src/app/components/CustomerSignup.jsx';
        createRoot(document.getElementById('root')).render(React.createElement(MemoryRouter,null,
          React.createElement(AuthProvider,null,React.createElement(CustomerSignup))));`;
    },
    configureServer(vite) { vite.middlewares.use((req, res, next) => {
      if (req.url !== "/__signup_test") return next();
      res.setHeader("Content-Type", "text/html");
      res.end('<!doctype html><html><body><div id="root"></div><script type="module" src="/__signup_entry.js"></script></body></html>');
    }); },
  }],
});
let browser;
try {
  await server.listen();
  console.log("Signup fixture listening; launching Chromium.");
  browser = await chromium.launch({ headless: true, timeout: 15000 });
  console.log("Chromium ready; testing signup.");
  const page = await browser.newPage();
  page.setDefaultTimeout(10000);
  await page.route("**/*", route => new URL(route.request().url()).hostname === "127.0.0.1"
    ? route.continue() : route.abort());
  const errors = [], submissions = [], checks = [];
  page.on("pageerror", error => { errors.push(error.message); console.error(error.stack); });
  await page.route("**/api/auth/register/**", async route => {
    const request = route.request();
    if (new URL(request.url()).pathname.endsWith("/profile")) {
      submissions.push(request.postDataJSON());
      await route.fulfill({ status: 202, json: { deliveryStatus: "pending",
        message: "Your account was created, but the activation email could not be sent. Request a new activation link.",
        profile: { uid: "new-customer", email: "customer@gmail.com" } } });
    } else {
      checks.push(request.postDataJSON());
      await route.fulfill({ status: 409, json: { message: "A stale pre-check must not block signup." } });
    }
  });
  await page.goto(`${server.resolvedUrls.local[0]}__signup_test`, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.getByPlaceholder("Enter your full name").fill("Test Customer");
  await page.getByPlaceholder("Enter your email").fill("customer@gmail.com");
  await page.getByPlaceholder("Choose a profile username").fill("test_customer");
  await page.getByPlaceholder("9XXXXXXXXX", { exact: true }).fill("9940702702");
  await page.getByPlaceholder("Create a password").fill("Roanpogi03.");
  await page.getByPlaceholder("Repeat your password").fill("Different03.");
  assert.equal(checks.length, 0, "Typing must not trigger duplicate checks");
  assert.equal(submissions.length, 0, "Typing must not submit a registration");
  await page.getByRole("button", { name: "Create account", exact: true }).click();
  await page.getByRole("dialog").locator("div.overflow-y-auto").evaluate(element => {
    element.scrollTop = element.scrollHeight; element.dispatchEvent(new Event("scroll"));
  });
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Agree and continue" }).click();
  await page.getByRole("button", { name: "Create account", exact: true }).click();
  await page.getByRole("alert").filter({ hasText: "Passwords do not match." }).waitFor();
  assert.equal(submissions.length, 0, "A genuine mismatch must not reach the API");

  await page.getByPlaceholder("Repeat your password").fill("Roanpogi03. ");
  assert.equal(await page.getByRole("alert").count(), 0, "Editing must clear stale mismatch feedback");
  await page.getByRole("button", { name: "Create account", exact: true }).click();
  await page.getByRole("alert").filter({ hasText: "Passwords do not match." }).waitFor();
  assert.equal(submissions.length, 0, "Whitespace differences must not be silently trimmed");
  await page.getByRole("button", { name: "Show password", exact: true }).click();
  await page.getByRole("button", { name: "Show confirmation password", exact: true }).click();

  // Simulate a password manager changing the visible value without React's onChange.
  await page.getByPlaceholder("Repeat your password").evaluate(element => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(element, "Roanpogi03.");
  });
  await page.getByRole("button", { name: "Create account", exact: true }).click();
  await page.getByRole("status").filter({ hasText: "Your account was created" }).waitFor({ timeout: 5000 });
  await page.getByRole("link", { name: "Link expired or missing? Request another activation link" }).waitFor();
  // A second submit event after success must not provision another account.
  await page.locator("form").evaluate(form => form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
  assert.equal(submissions.length, 1);
  assert.equal(checks.length, 0, "Registration must not be gated by a separate availability request");
  assert.equal(submissions[0].password, "Roanpogi03.");
  assert.equal(submissions[0].fullName, "Test Customer");
  assert.equal(submissions[0].email, "customer@gmail.com");
  assert.equal(submissions[0].username, "test_customer");
  assert.equal(submissions[0].phone, "+63 9940702702");
  assert.equal(await page.getByPlaceholder("Create a password").inputValue(), "");
  assert.equal(await page.getByPlaceholder("Repeat your password").inputValue(), "");
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.getByPlaceholder("Enter your email").fill("customer@gmail.com");
  await page.getByPlaceholder("Choose a profile username").fill("test_customer");
  await page.getByPlaceholder("9XXXXXXXXX", { exact: true }).fill("9940702702");
  await page.getByPlaceholder("Create a password").fill("Roanpogi03.");
  await page.getByPlaceholder("Repeat your password").fill("Roanpogi03.");
  await page.getByRole("button", { name: "Create account", exact: true }).click();
  await page.getByRole("dialog").locator("div.overflow-y-auto").evaluate(element => {
    element.scrollTop = element.scrollHeight; element.dispatchEvent(new Event("scroll"));
  });
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Agree and continue" }).click();
  await page.getByRole("button", { name: "Create account", exact: true }).click();
  await page.getByRole("status").filter({ hasText: "Your account was created" }).waitFor();
  assert.equal(submissions.length, 2);
  assert.equal(submissions[1].fullName, "test_customer", "A missing full name must use the username");
  assert.equal(errors.length, 0, errors.join("\n"));
  console.log("PASS: signup submits the actual name or username fallback; matching passwords submit and genuine mismatches are blocked.");
} finally {
  await browser?.close();
  await server.close();
  rmSync(cacheDir, { recursive: true, force: true });
}
