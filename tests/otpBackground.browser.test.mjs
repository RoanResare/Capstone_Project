import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { chromium } from "playwright";
import { createServer } from "node:http";
import { existsSync, readFileSync } from "node:fs";
import { extname, join, resolve } from "node:path";

const distribution = resolve("dist");
let server;
let browser;
let baseUrl;
before(async () => {
  const mime = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".png": "image/png", ".svg": "image/svg+xml", ".woff2": "font/woff2" };
  server = createServer((request, response) => {
    const pathname = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
    const candidate = resolve(distribution, `.${pathname}`);
    const served = candidate.startsWith(distribution) && existsSync(candidate) ? candidate : join(distribution, "index.html");
    response.setHeader("Content-Type", mime[extname(served)] || "application/octet-stream");
    response.end(readFileSync(served));
  });
  await new Promise(resolveListen => server.listen(0, "127.0.0.1", resolveListen));
  baseUrl = `http://127.0.0.1:${server.address().port}/verify-otp`;
  browser = await chromium.launch({ headless: true, args: ["--no-proxy-server", "--proxy-bypass-list=*"] });
});
after(async () => {
  await browser?.close();
  if (server?.listening) await new Promise(resolveClose => server.close(resolveClose));
});

test("built OTP page renders the shared authentication image responsively with the challenge controls", async () => {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const future = Math.floor(Date.now() / 1000) + 3600;
  const ticket = `e30.${Buffer.from(JSON.stringify({ exp: future })).toString("base64url")}.fixture`;
  const challenge = JSON.stringify({ role: "admin", email: "fixture@example.test", otpTicket: ticket,
    otpExpiresAt: new Date(Date.now() + 180000).toISOString(), resendAvailableAt: new Date(0).toISOString(), deliveryMode: "email" });
  await page.addInitScript(value => {
    localStorage.setItem("furfection-pending-otp", value);
    sessionStorage.setItem("furfection-pending-otp", value);
  }, challenge);
  await page.goto(baseUrl, { waitUntil: "load", timeout: 15000 });
  await page.getByRole("heading", { name: "Verify Your Account" }).waitFor({ timeout: 15000 });
  const background = page.locator('img[src*="login-pets-hero"]');
  assert.equal(await background.count(), 1);
  const asset = await background.evaluate(image => ({ loaded: image.complete && image.naturalWidth > 0, fit: getComputedStyle(image).objectFit }));
  assert.equal(asset.loaded, true, "the existing pet-themed auth image loads on OTP");
  assert.equal(asset.fit, "cover");
  const code = page.getByPlaceholder("Enter the 6-digit code");
  await code.fill("12ab3456789");
  assert.equal(await code.inputValue(), "123456", "OTP entry remains six numeric digits");
  assert.equal(await page.getByRole("button", { name: /Verify and continue/ }).isEnabled(), true);
  assert.equal(await page.getByRole("button", { name: "Resend code" }).isEnabled(), true);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(100);
  const sizes = await page.evaluate(() => ({ viewport: innerWidth, document: document.documentElement.scrollWidth }));
  assert.ok(sizes.document <= sizes.viewport, `OTP mobile layout overflows: ${JSON.stringify(sizes)}`);
  await page.close();
});
