import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { createServer } from "vite";

const { chromium } = await import(process.env.SIGNUP_PLAYWRIGHT_MODULE
  ? pathToFileURL(process.env.SIGNUP_PLAYWRIGHT_MODULE).href : "playwright");
const cacheDir = mkdtempSync(join(tmpdir(), "capstone-portal-notifications-"));
const cssFile = readdirSync(new URL("../dist/assets/", import.meta.url)).find(name => /^index-.*\.css$/.test(name));
assert.ok(cssFile, "Run npm run build:frontend before this browser test");
const productionCss = readFileSync(new URL(`../dist/assets/${cssFile}`, import.meta.url), "utf8");
const mocks = {
  "context/AppContext.jsx": `import React, {createContext,useContext,useState} from 'react';
    const Context=createContext(null);
    export function useApp(){return useContext(Context)}
    export function MockAppProvider({children}){
      const [visibleNotifications,setNotifications]=useState([]);
      const currentUser={id:'admin-1',uid:'admin-1',role:'admin',name:'Admin User',username:'admin',email:'admin@example.test'};
      window.currentUser=currentUser;
      const value={currentUser,accessibleModules:[{id:'appointments',label:'Manage Appointments'}],visibleNotifications,
        markNotificationRead(){},markAllNotificationsRead(){}};
      window.currentNotifications=visibleNotifications;
      window.addNotification=n=>setNotifications(current=>current.some(item=>item.id===n.id)?[...current]:[...current,n]);
      return React.createElement(Context.Provider,{value},children);
    }`,
  "context/AuthContext.jsx": "export function useAuth(){return {signOut:async()=>{}}}",
};
const server = await createServer({ configFile: false, logLevel: "silent", cacheDir,
  esbuild: { jsx: "automatic" }, resolve: { dedupe: ["react", "react-dom"] },
  optimizeDeps: { include: ["react", "react-dom/client", "react-router-dom", "motion/react", "lucide-react"] },
  server: { host: "127.0.0.1", port: 0 },
  plugins: [{ name: "portal-notification-fixture", enforce: "pre",
    resolveId(source) {
      if (source === "/__portal_entry.js") return "\0portal-entry";
      const key = Object.keys(mocks).find(name => source.endsWith(`/${name}`));
      if (key) return `\0portal-mock:${key}`;
    },
    load(id) {
      if (id.startsWith("\0portal-mock:")) return mocks[id.slice("\0portal-mock:".length)];
      if (id === "\0portal-entry") return `import React from 'react';import {createRoot} from 'react-dom/client';
        import {MemoryRouter,Routes,Route,useLocation} from 'react-router-dom';
        import {ToastProvider} from '/src/app/context/ToastContext.jsx';
        import {MockAppProvider} from '/src/app/context/AppContext.jsx';
        import {PortalLayout} from '/src/app/components/portal/PortalLayout.jsx';
        function RouteView(){const location=useLocation();return React.createElement('p',{'data-testid':'route'},location.pathname+location.search)}
        createRoot(document.getElementById('root')).render(React.createElement(ToastProvider,null,
          React.createElement(MockAppProvider,null,React.createElement(MemoryRouter,{initialEntries:['/portal/appointments']},
            React.createElement(Routes,null,React.createElement(Route,{path:'/portal',element:React.createElement(PortalLayout)},
              React.createElement(Route,{path:'appointments',element:React.createElement(RouteView)})))))));`;
    },
    configureServer(vite) { vite.middlewares.use((req, res, next) => {
      if (req.url !== "/__portal_notifications") return next();
      res.setHeader("Content-Type", "text/html");
      res.end(`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>${productionCss}</style></head><body><div id="root"></div><script type="module" src="/__portal_entry.js"></script></body></html>`);
    }); },
  }],
});
let browser;
try {
  await server.listen();
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  page.setDefaultTimeout(60000);
  const errors = [];
  page.on("pageerror", error => errors.push(error.stack));
  await page.route("**/*", route => new URL(route.request().url()).hostname === "127.0.0.1"
    ? route.continue() : route.abort());
  await page.goto(`${server.resolvedUrls.local[0]}__portal_notifications`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.getByRole("heading", { name: "Hi admin", exact: true }).waitFor();
  await page.waitForTimeout(100);
  const notification = {
    id: "appointment-booking-1-created", title: "New appointment booking",
    message: "Sam Customer booked Vaccination for 2030-01-05 at 09:00.",
    targetRoles: ["admin", "staff"], targetType: "appointment", targetId: "booking-1",
    relatedAppointmentId: "booking-1", targetHref: "/portal/appointments?appointment=booking-1&notification=appointment-booking-1-created",
    actorName: "Sam Customer", actorRole: "customer", actionLabel: "Booked appointment",
    appointmentDate: "2030-01-05", appointmentTime: "09:00", serviceName: "Vaccination", petName: "Milo",
    level: "info", readBy: [], createdAt: new Date().toISOString(),
  };
  await page.evaluate(value => window.addNotification(value), notification);
  await page.waitForFunction(() => window.currentNotifications?.length === 1);
  if (errors.length) console.error("Portal fixture page errors", errors);
  await page.getByText(notification.message, { exact: true }).waitFor();
  assert.equal(await page.getByText(notification.message, { exact: true }).count(), 1,
    "A new booking should produce one visible toast");
  await page.evaluate(value => window.addNotification(value), notification);
  await page.waitForTimeout(150);
  assert.equal(await page.getByText(notification.message, { exact: true }).count(), 1,
    "Repeated Realtime delivery for the same ID must not duplicate the toast");
  const notificationButton = page.getByRole("button", { name: /Notifications/ });
  await notificationButton.waitFor();
  assert.match(await notificationButton.innerText(), /Notifications\s*1/);
  await notificationButton.click();
  await page.getByRole("button", { name: /New appointment booking/ }).click();
  await page.getByTestId("route").filter({ hasText: "appointment=booking-1" }).waitFor();
  assert.match(await page.getByTestId("route").textContent(), /notification=appointment-booking-1-created/);
  assert.deepEqual(errors, []);
  console.log("PASS: live appointment notification toast, badge/list update, duplicate suppression, and appointment navigation.");
} finally {
  await browser?.close();
  await server.close();
  rmSync(cacheDir, { recursive: true, force: true });
}
