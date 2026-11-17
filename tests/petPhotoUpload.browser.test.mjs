import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { chromium } from "playwright";
import { build } from "vite";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { createServer } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { join, resolve, extname } from "node:path";
import { tmpdir } from "node:os";
import { mkdtemp } from "node:fs/promises";

let server;
let browser;
let baseUrl;
let outputDirectory;
before(async () => {
  const root = fileURLToPath(new URL("..", import.meta.url));
  outputDirectory = await mkdtemp(join(tmpdir(), "pet-photo-browser-"));
  const uploadFixture = fileURLToPath(new URL("./fixtures/pet-photo-upload.html", import.meta.url));
  const reviewFixture = fileURLToPath(new URL("./fixtures/pet-photo-review.html", import.meta.url));
  await build({ configFile: false, plugins: [react(), tailwindcss()], root,
    build: { outDir: outputDirectory, emptyOutDir: true, rollupOptions: { input: { upload: uploadFixture, review: reviewFixture } } } });
  const mime = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".png": "image/png", ".svg": "image/svg+xml" };
  server = createServer((request, response) => {
    const pathname = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
    const candidate = resolve(outputDirectory, `.${pathname}`);
    if (!candidate.startsWith(resolve(outputDirectory)) || !existsSync(candidate)) { response.writeHead(404).end(); return; }
    response.setHeader("Content-Type", mime[extname(candidate)] || "application/octet-stream");
    response.end(readFileSync(candidate));
  });
  await new Promise(resolveListen => server.listen(0, "127.0.0.1", resolveListen));
  const address = server.address();
  baseUrl = `http://127.0.0.1:${address.port}/tests/fixtures/pet-photo-upload.html`;
  browser = await chromium.launch({ headless: true, args: ["--no-proxy-server", "--proxy-bypass-list=*"] });
});
after(async () => {
  await browser?.close();
  if (server?.listening) await new Promise(resolveClose => server.close(resolveClose));
});

function png(red) {
  const crc = bytes => { let value = 0xffffffff; for (const byte of bytes) { value ^= byte; for (let i = 0; i < 8; i++) value = value >>> 1 ^ (value & 1 ? 0xedb88320 : 0); } return (value ^ 0xffffffff) >>> 0; };
  const chunk = (name, data) => { const type = Buffer.from(name); const size = Buffer.alloc(4); size.writeUInt32BE(data.length); const sum = Buffer.alloc(4); sum.writeUInt32BE(crc(Buffer.concat([type, data]))); return Buffer.concat([size, type, data, sum]); };
  const header = Buffer.alloc(13); header.writeUInt32BE(1); header.writeUInt32BE(1, 4); header.set([8, 6, 0, 0, 0], 8);
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk("IHDR", header), chunk("IDAT", deflateSync(Buffer.from([0,red,0,0,255]))), chunk("IEND", Buffer.alloc(0))]);
}

async function assertPetLayoutFits(page, hasPhoto) {
  for (const width of [320, 375, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    const sizes = await page.evaluate(() => {
      const form = document.querySelector("form");
      const photo = form.querySelector('[aria-labelledby] > div');
      const formRect = form.getBoundingClientRect();
      const fields = [...form.querySelectorAll("input:not([type=file]), select, textarea")].map(field => field.getBoundingClientRect());
      const actions = [...form.querySelectorAll("[aria-label*=Photo], button")].map(button => button.getBoundingClientRect());
      return { viewport: innerWidth, document: document.documentElement.scrollWidth, form: formRect.width,
        fieldsWithinForm: fields.every(rect => rect.left >= formRect.left && rect.right <= formRect.right + 1),
        photoWithinForm: photo.getBoundingClientRect().right <= formRect.right + 1,
        actionsWithinForm: actions.every(rect => rect.left >= formRect.left - 1 && rect.right <= formRect.right + 1) };
    });
    assert.ok(sizes.document <= sizes.viewport, `layout overflows horizontally at ${width}px: ${JSON.stringify(sizes)}`);
    assert.ok(sizes.fieldsWithinForm && sizes.photoWithinForm && sizes.actionsWithinForm,
      `pet fields or photo controls exceed the form at ${width}px (photo=${hasPhoto}): ${JSON.stringify(sizes)}`);
  }
}

test("pet photo upload UI works at desktop and mobile sizes with validation and form preservation", async () => {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.goto(baseUrl, { waitUntil: "load", timeout: 10000 });
  await page.getByText("Add a Photo of Your Pet").waitFor({ timeout: 15000 });
  const input = page.getByLabel("Pet Photo (Optional)");
  await assert.doesNotReject(() => input.waitFor({ state: "attached" }));
  const inputBounds = await input.boundingBox();
  assert.ok(inputBounds.width <= 1 && inputBounds.height <= 1, "native file control is visually hidden but keyboard/screen-reader accessible");
  assert.equal(await page.getByText("Help our staff recognize your dog or cat.").isVisible(), true);
  assert.equal(await page.getByText("JPG, PNG or WebP · Maximum 1 MB").isVisible(), true);
  const card = page.locator("section[aria-labelledby]").locator("div.rounded-\\[20px\\]").first();
  const cardStyle = await card.evaluate(element => ({ border: getComputedStyle(element).borderTopStyle, background: getComputedStyle(element).backgroundImage }));
  assert.equal(cardStyle.border, "dashed");
  assert.notEqual(cardStyle.background, "none");
  await input.setInputFiles({ name: "pet.png", mimeType: "image/png", buffer: png(240) });
  const preview = page.getByAltText("Milo photo preview");
  await preview.waitFor();
  assert.equal(await preview.evaluate(image => getComputedStyle(image).objectFit), "cover");
  assert.equal(await page.getByRole("button", { name: "Change Photo" }).isVisible(), true);
  const oldPhoto = await preview.getAttribute("src");
  const changePhoto = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Change Photo" }).click();
  await (await changePhoto).setFiles({ name: "pet-replacement.png", mimeType: "image/png", buffer: png(25) });
  await page.waitForFunction(previous => document.querySelector('[alt="Milo photo preview"]')?.src !== previous, oldPhoto);
  await page.getByRole("button", { name: "Save changes" }).click();
  assert.equal(await page.locator("output").textContent(), "saved-with-photo", "valid photo saves with the pet profile");
  await page.reload({ waitUntil: "load" });
  await page.getByAltText("Milo photo preview").waitFor();
  assert.equal(await page.locator("output").textContent(), "loaded-saved-pet", "saved pet photo reloads from the fixture record");
  await assertPetLayoutFits(page, true);
  const desktopScreenshot = join(outputDirectory, "pet-widget-desktop-uploaded.png");
  await page.screenshot({ path: desktopScreenshot, fullPage: true });
  await page.setViewportSize({ width: 320, height: 900 });
  const mobileScreenshot = join(outputDirectory, "pet-widget-mobile-320-uploaded.png");
  await page.screenshot({ path: mobileScreenshot, fullPage: true });
  console.log(`Pet widget screenshots: ${desktopScreenshot} | ${mobileScreenshot}`);
  await page.getByRole("button", { name: "Remove Photo" }).click();
  assert.equal(await page.getByText("Add a Photo of Your Pet").isVisible(), true);
  await assertPetLayoutFits(page, false);
  await page.getByRole("button", { name: "Save changes" }).click();
  assert.equal(await page.locator("output").textContent(), "saved-without-photo", "pet saving still works without a photo");

  await input.setInputFiles({ name: "wrong-type.txt", mimeType: "text/plain", buffer: Buffer.from("not allowed") });
  assert.match(await page.getByRole("alert").textContent(), /JPG, PNG, or WebP/i);
  await input.setInputFiles({ name: "corrupt.png", mimeType: "image/png", buffer: Buffer.from("not an image") });
  await page.getByRole("alert").filter({ hasText: /corrupt|cannot be decoded/i }).waitFor();
  assert.match(await page.getByRole("alert").textContent(), /corrupt|cannot be decoded/i);
  await input.setInputFiles({ name: "large.png", mimeType: "image/png", buffer: Buffer.alloc(1024 * 1024 + 1) });
  assert.match(await page.getByRole("alert").textContent(), /1 MB or smaller/i);
  await page.close();
});

test("Admin/Staff pet review thumbnails, paw fallback, association, and modal work in Chromium", async () => {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.goto(baseUrl.replace("pet-photo-upload.html", "pet-photo-review.html"), { waitUntil: "load" });
  assert.equal(await page.getByText("Associated pet: Betty").isVisible(), true);
  assert.equal(await page.getByTestId("missing-link").textContent(), "Missing linked record: none");
  assert.equal(await page.getByLabel("No pet photo uploaded").count(), 1, "pet without photo uses the paw fallback");
  const bettyImage = page.getByRole("button", { name: "View Betty photo" }).first();
  assert.equal(await bettyImage.locator("img").evaluate(image => getComputedStyle(image).objectFit), "cover");
  await bettyImage.click();
  const dialog = page.getByRole("dialog", { name: "Betty pet photo" });
  await dialog.waitFor();
  assert.equal(await dialog.locator("img").getAttribute("alt"), "Betty pet");
  await dialog.getByRole("button", { name: "Close pet photo" }).click();
  assert.equal(await dialog.count(), 0);
  await page.close();
});
