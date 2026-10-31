import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { createServer } from "vite";

const { chromium } = await import(process.env.SIGNUP_PLAYWRIGHT_MODULE
  ? pathToFileURL(process.env.SIGNUP_PLAYWRIGHT_MODULE).href : "playwright");
const cacheDir = mkdtempSync(join(tmpdir(), "capstone-login-chat-test-"));
// Run after build: validate responsive classes against the actual production CSS.
const cssFile = readdirSync(new URL("../dist/assets/", import.meta.url)).find(name => /^index-.*\.css$/.test(name));
assert.ok(cssFile, "Run npm run build:frontend before this browser test");
const productionCss = readFileSync(new URL(`../dist/assets/${cssFile}`, import.meta.url), "utf8");
const mocks = {
  "context/AuthContext.jsx": `export function useAuth() {return {
    currentUser: null, isLoading: false, isAuthenticated: false, isOnline: true,
    beginUnifiedLogin: async values => {window.loginRequests.push(values); return {ok:false,error:'Test credentials rejected.'};}
  };}`,
  "context/ToastContext.jsx": "export function useToast() {return {error(){},success(){},info(){}};}",
  "context/AppContext.jsx": "export function useApp() {return {logChatbotInquiry(value){window.chatLogs.push(value);}};}",
};
const server = await createServer({ configFile: false, logLevel: "silent", cacheDir,
  esbuild: { jsx: "automatic" }, resolve: { dedupe: ["react", "react-dom"] },
  optimizeDeps: { include: ["react", "react-dom/client", "react-router-dom", "motion/react", "lucide-react"] },
  define: { "import.meta.env.VITE_API_URL": JSON.stringify("/api") },
  server: { host: "127.0.0.1", port: 0 },
  plugins: [{ name: "login-chat-fixture", enforce: "pre",
    resolveId(source) {
      if (source === "/__fixture_entry.js") return "\0fixture-entry";
      const key = Object.keys(mocks).find(key => source.endsWith(`/${key}`));
      if (key) return `\0fixture-mock:${key}`;
    },
    load(id) {
      if (id.startsWith("\0fixture-mock:")) return mocks[id.slice("\0fixture-mock:".length)];
      if (id === "\0fixture-entry") return `import React from 'react';
        import {createRoot} from 'react-dom/client'; import {MemoryRouter} from 'react-router-dom';
        import {UnifiedLogin} from '/src/app/components/UnifiedLogin.jsx';
        import {ChatbotWidget} from '/src/app/components/ChatbotWidget.jsx';
        window.loginRequests=[]; window.chatLogs=[];
        const chat=new URLSearchParams(location.search).has('chat');
        createRoot(document.getElementById('root')).render(React.createElement(MemoryRouter,
          {initialEntries:[chat?'/services':'/login?emailVerified=1']},React.createElement(chat?ChatbotWidget:UnifiedLogin)));`;
    },
    configureServer(vite) { vite.middlewares.use((req,res,next) => {
      if (!req.url.startsWith("/__fixture")) return next();
      if (req.url.startsWith("/__fixture_entry")) return next();
      res.setHeader("Content-Type", "text/html");
      res.end(`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>${productionCss}</style></head><body><div id="root"></div><script type="module" src="/__fixture_entry.js"></script></body></html>`);
    }); },
  }],
});
let browser;
try {
  await server.listen();
  console.log("Login/chat fixture listening; launching Chromium.");
  browser = await chromium.launch({ headless: true });
  console.log("Chromium ready; testing responsive login.");
  const page = await browser.newPage();
  page.setDefaultTimeout(60000);
  const errors = [];
  page.on("pageerror", error => errors.push(error.stack));
  await page.route("**/*", route => new URL(route.request().url()).hostname === "127.0.0.1"
    ? route.continue() : route.abort());
  const base = server.resolvedUrls.local[0];
  await page.setViewportSize({ width: 375, height: 667 });
  await page.goto(`${base}__fixture`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.getByRole("heading", { name: "Welcome Back!" }).waitFor();
  await page.getByText("Your email is verified. You can now sign in.", {exact:true}).waitFor();
  await page.getByRole("button", { name: "Log In", exact: true }).click();
  assert.equal(await page.evaluate(() => window.loginRequests.length), 0);
  await page.getByText("Email or username is required.", {exact:true}).waitFor();
  assert.ok((await page.getByRole("heading", {name:"Welcome Back!"}).boundingBox()).y < 200);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await page.getByPlaceholder("Enter your email or username").fill("customer_username");
  await page.getByPlaceholder("Enter your password").evaluate(input => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set.call(input,"Exact!Pass123 ");
  });
  await page.getByRole("button", { name: "Log In", exact:true }).click();
  await page.getByText("Test credentials rejected.", {exact:true}).waitFor();
  assert.deepEqual(await page.evaluate(() => window.loginRequests[0]), {
    identifier:"customer_username",password:"Exact!Pass123 ",requestedPath:"",rememberDevice:false,
  });
  await page.getByRole("button", { name:"Show password",exact:true }).click();
  assert.equal(await page.getByPlaceholder("Enter your password").getAttribute("type"),"text");
  await page.setViewportSize({width:1440,height:1000});
  await page.waitForTimeout(500);
  const heading = await page.getByRole("heading",{name:"Welcome Back!"}).boundingBox();
  assert.ok(heading.x > 700, "Desktop login remains beside the existing hero");
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),false);

  const requests=[];
  console.log("Login passed; testing contextual Groq requests.");
  await page.route("**/api/groq-chat",async route => {
    requests.push(route.request().postDataJSON());
    // Delay the response to exercise the synchronous duplicate-request guard.
    await new Promise(resolve => setTimeout(resolve,150));
    await route.fulfill({status:200,json:requests.length===3
      ? {answer:"Live chat is unavailable. Please try again.",provider:"fallback",warning:"Provider unavailable"}
      : {answer:requests.length===1?"Consultations are available.":"Maaari kang mag-book sa customer dashboard.",provider:"groq"}});
  });
  await page.goto(`${base}__fixture?chat=1`, { waitUntil: "domcontentloaded", timeout: 60000 });
  const input=page.getByPlaceholder("Ask about services, prices, schedules, policies, or appointments");
  await input.fill("Tell me about consultation.");
  await page.locator("form").evaluate(form => {
    form.dispatchEvent(new Event("submit",{bubbles:true,cancelable:true}));
    form.dispatchEvent(new Event("submit",{bubbles:true,cancelable:true}));
  });
  await page.getByText("Consultations are available.",{exact:true}).waitFor();
  assert.equal(requests.length,1);
  await input.fill("Paano mag-book ng appointment?");
  await page.getByRole("button",{name:"Ask chatbot",exact:true}).click();
  await page.getByText("Maaari kang mag-book sa customer dashboard.",{exact:true}).waitFor();
  assert.deepEqual(requests[1].history,[
    {role:"user",content:"Tell me about consultation."},
    {role:"assistant",content:"Consultations are available."},
  ]);
  assert.equal(await page.getByRole("link",{name:"Book an appointment"}).getAttribute("href"),"/customer/dashboard?tab=services");
  await input.fill("Are you open?");
  await page.getByRole("button",{name:"Ask chatbot",exact:true}).click();
  await page.getByText("Live chat is unavailable. Please try again.",{exact:true}).waitFor();
  assert.equal(await page.evaluate(() => window.chatLogs.at(-1).provider),"fallback");
  assert.equal(requests.some(request => "apiKey" in request || "GROQ_API_KEY" in request),false);
  assert.deepEqual(errors,[]);
  console.log("PASS: responsive login, autofill validation, verification feedback, contextual Groq requests, duplicate prevention, booking link and outage fallback.");
} finally {
  await browser?.close();
  await server.close();
  rmSync(cacheDir,{recursive:true,force:true});
}
