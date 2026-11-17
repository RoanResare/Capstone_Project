import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { createServer } from "vite";
import tailwindcss from "@tailwindcss/vite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const { chromium } = await import(process.env.SIGNUP_PLAYWRIGHT_MODULE
  ? pathToFileURL(process.env.SIGNUP_PLAYWRIGHT_MODULE).href : "playwright");
const cacheDir = mkdtempSync(join(tmpdir(), "capstone-chatbot-test-"));
const mocks = {
  "context/AppContext.jsx": "export function useApp() { return {logChatbotInquiry() {}}; }",
  "services/groq.js": `export const CHAT_TIMEOUT_ERROR_MESSAGE = 'Try again';
    export const groqSuggestionChips = ['View Services', 'Grooming Prices', 'Book Appointment', 'Clinic Hours'];
    export async function getGroqRuntimeStatus() { return {ready:true,summary:'Ready',helpText:''}; }
    export async function askGroqAssistantStream({onToken}) {
      const answer = '| Category | Services |\\n| --- | --- |\\n| Grooming | Basic Groom, Bath & Blow-dry |\\n| Veterinary | Consultation |\\n\\n<img src=x onerror=alert(1)>';
      onToken(answer); return {answer,provider:'groq',topic:'services'};
    }`,
};
const server = await createServer({
  configFile: false, logLevel: "silent", cacheDir,
  optimizeDeps: { include: ["react", "react-dom/client", "react-router-dom"] },
  esbuild: { jsx: "automatic" },
  server: { host: "127.0.0.1", port: 5199 },
  plugins: [{ name: "chatbot-responsive-fixture", enforce: "pre",
    resolveId(source) {
      if (source === "/__chatbot_entry.js") return "\0chatbot-entry";
      if (source === "motion/react") return "\0chatbot-motion";
      if (source === "lucide-react") return "\0chatbot-icons";
      const key = Object.keys(mocks).find((candidate) => candidate && source.endsWith(`/${candidate}`));
      if (key) return `\0chatbot-mock:${key}`;
    },
    load(id) {
      if (id.startsWith("\0chatbot-mock:")) return mocks[id.slice("\0chatbot-mock:".length)];
      if (id === "\0chatbot-motion") return `import React from 'react'; export const AnimatePresence=({children})=>children;
        export const motion=new Proxy({}, {get:(_target,tag)=>({children,...props})=>React.createElement(tag,props,children)});`;
      if (id === "\0chatbot-icons") return "export const Bot=()=>null,LoaderCircle=()=>null,MessageCircleMore=()=>null,SendHorizontal=()=>null,X=()=>null;";
      if (id === "\0chatbot-entry") return `import '/src/styles/index.css'; import React from 'react'; import {createRoot} from 'react-dom/client';
        import {MemoryRouter} from 'react-router-dom'; import {AskLlamaAI} from '/src/app/components/AskLlamaAI.jsx';
        createRoot(document.getElementById('root')).render(React.createElement(MemoryRouter,null,React.createElement(AskLlamaAI)));`;
    },
    configureServer(vite) { vite.middlewares.use((req, res, next) => {
      if (req.url !== "/__chatbot_test") return next();
      res.setHeader("Content-Type", "text/html");
      res.end('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/__chatbot_entry.js"></script></body></html>');
    }); },
  }, tailwindcss()],
});
let browser;
try {
  await server.listen();
  browser = await chromium.launch({ headless: true, timeout: 15000 });
  const page = await browser.newPage({ viewport: { width: 320, height: 720 } });
  await page.route("**/*", (route) => new URL(route.request().url()).hostname === "127.0.0.1"
    ? route.continue() : route.abort());
  await page.goto(`${server.resolvedUrls.local[0]}__chatbot_test`, { waitUntil: "domcontentloaded", timeout: 90000 });
  await page.getByRole("button", { name: "Charming Assistant" }).click();
  await page.getByRole("textbox", { name: "Message to Charming Assistant" }).fill("What services do you offer?");
  await page.getByRole("button", { name: "Send message to Charming Assistant" }).click();
  const log = page.getByRole("log");
  const serviceRows = log.locator('[aria-label="Service details"] > section');
  await serviceRows.nth(1).waitFor();
  assert.equal(await serviceRows.count(), 2);
  assert.equal(await log.locator("img").count(), 0, "AI-provided HTML must render as inert text");
  assert.ok((await log.innerText()).includes("<img src=x onerror=alert(1)>"));

  const mobileLayout = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    pageWidth: document.documentElement.scrollWidth,
    logWidth: document.querySelector('[role="log"]').scrollWidth,
    logClientWidth: document.querySelector('[role="log"]').clientWidth,
    messageWidths: [...document.querySelectorAll('[role="log"] > div')]
      .filter((row) => row.querySelector(':scope > div'))
      .map((row) => Math.round(row.querySelector(':scope > div').getBoundingClientRect().width)),
    chipRows: [...document.querySelectorAll("#charming-assistant-panel button")]
      .filter((button) => ["View Services", "Grooming Prices", "Book Appointment", "Clinic Hours"].includes(button.textContent.trim()))
      .map((button) => ({ top: Math.round(button.getBoundingClientRect().top), left: Math.round(button.getBoundingClientRect().left), width: Math.round(button.getBoundingClientRect().width) })),
  }));
  assert.ok(mobileLayout.pageWidth <= mobileLayout.viewport, JSON.stringify(mobileLayout));
  assert.ok(mobileLayout.logWidth <= mobileLayout.logClientWidth, JSON.stringify(mobileLayout));
  const assistantWidth = mobileLayout.messageWidths.at(-1);
  assert.ok(assistantWidth >= mobileLayout.logClientWidth * 0.9, JSON.stringify(mobileLayout));
  assert.equal(mobileLayout.chipRows.length, 4);
  assert.equal(new Set(mobileLayout.chipRows.map((button) => button.top)).size, 2, "Suggestion chips should use two mobile rows");
  assert.equal(new Set(mobileLayout.chipRows.map((button) => button.left)).size, 2, "Suggestion chips should use two balanced mobile columns");
  assert.ok(Math.abs(mobileLayout.chipRows[0].width - mobileLayout.chipRows[1].width) <= 1, JSON.stringify(mobileLayout));

  for (const width of [375, 390, 768, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    const fitting = await page.evaluate(() => ({ viewport: document.documentElement.clientWidth,
      page: document.documentElement.scrollWidth, log: document.querySelector('[role="log"]').scrollWidth,
      logClient: document.querySelector('[role="log"]').clientWidth }));
    assert.ok(fitting.page <= fitting.viewport && fitting.log <= fitting.logClient, JSON.stringify({ width, fitting }));
  }
  await page.setViewportSize({ width: 1280, height: 900 });
  const desktopLayout = await page.evaluate(() => ({ viewport: document.documentElement.clientWidth, page: document.documentElement.scrollWidth,
    panel: document.querySelector("#charming-assistant-panel").getBoundingClientRect().width }));
  assert.ok(desktopLayout.page <= desktopLayout.viewport, JSON.stringify(desktopLayout));
  assert.ok(desktopLayout.panel > 300 && desktopLayout.panel <= 408, JSON.stringify(desktopLayout));
  console.log("PASS: chatbot service rendering, inert AI markup, full-width replies, 2x2 mobile suggestions, responsive widths, and desktop layout.");
} finally {
  await browser?.close();
  await server.close();
  rmSync(cacheDir, { recursive: true, force: true });
}
