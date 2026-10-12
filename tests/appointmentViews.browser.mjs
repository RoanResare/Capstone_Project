import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { createServer } from "vite";
import tailwindcss from "@tailwindcss/vite";

const { chromium } = await import(process.env.APPOINTMENT_PLAYWRIGHT_MODULE
  ? pathToFileURL(process.env.APPOINTMENT_PLAYWRIGHT_MODULE).href : "playwright");
const appMock = `
  import {useSyncExternalStore} from 'react';
  const listeners = new Set();
  const now = new Date();
  const month = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0');
  const staff = {id: 'staff', uid: 'staff', role: 'staff', name: 'Staff A', status: 'active'};
  const customer = {id: 'customer', uid: 'customer', role: 'customer', name: 'Customer', username: 'Customer', email: 'customer@example.com', status: 'active'};
  const records = [
    ['later', 'Later', 'Pending', '17', '09:00'],
    ['early', 'Earlier', 'Pending', '13', '09:00'],
    ['approved', 'Green', 'Confirmed', '14', '11:00'],
    ['completed', 'Finished', 'Completed', '15', '09:00'],
    ['cancelled', 'Cancelled Pet', 'Cancelled', '16', '09:00'],
    ['rejected', 'Rejected Pet', 'Rejected', '16', '11:00'],
    ['expired', 'Expired Pet', 'Expired', '17', '14:00'],
    ['accepted', 'Approved Pet', 'Accepted', '18', '09:00'],
  ].map(([id, petName, status, day, time], index) => ({id, petName, status, scheduleDate: month + '-' + day, scheduleTime: time,
    customerId: 'customer', customerEmail: 'customer@example.com', ownerName: 'Customer', petType: 'Dog', service: 'Vaccination',
    serviceId: 'vaccination', assignedStaff: status === 'Pending' ? '' : 'Staff A', createdAt: new Date(Date.now() - index * 100000).toISOString()}));
  let snapshot;
  const notify = () => listeners.forEach(fn => fn());
  const updateAppointment = async (id, changes) => {snapshot = {...snapshot, state: {...snapshot.state, appointments: snapshot.state.appointments.map(record => record.id === id ? {...record, ...changes} : record)}}; notify(); return true;};
  snapshot = {currentUser: staff, state: {appointments: records, petRecords: [], users: [{...staff, role: 'staff'}]},
    visibleNotifications: [], updateAppointment, kaponPromoReady: true, kaponPromoAvailable: false};
  window.__appointmentRole = role => {snapshot = {...snapshot, currentUser: role === 'customer' ? customer : staff}; notify();};
  export const useApp = () => useSyncExternalStore(fn => {listeners.add(fn); return () => listeners.delete(fn);}, () => snapshot);
`;
const mocks = {
  "context/AppContext.jsx": appMock,
  "context/AuthContext.jsx": "import {useApp} from '/src/app/context/AppContext.jsx'; export const useAuth = () => ({currentUser: useApp().currentUser, isAuthenticated: true, isLoading: false});",
  "context/ToastContext.jsx": "export const useToast = () => ({error() {}, success() {}});",
  "services/customerAccount.js": "export async function changeCustomerPassword() {}",
};
const server = await createServer({ configFile: false, server: { host: "127.0.0.1", port: 5199, strictPort: false }, logLevel: "silent",
  plugins: [tailwindcss(), { name: "appointment-browser-fixture", enforce: "pre",
    resolveId(source) {
      if (source === "/__appointment_entry.js") return "\0appointment-entry";
      const key = Object.keys(mocks).find((key) => source.endsWith(`/${key}`));
      if (key) return `\0appointment-mock:${key}`;
    },
    load(id) {
      if (id.startsWith("\0appointment-mock:")) return mocks[id.slice("\0appointment-mock:".length)];
      if (id === "\0appointment-entry") return `
        import React from 'react'; import {createRoot} from 'react-dom/client'; import {MemoryRouter} from 'react-router-dom';
        import {useApp} from '/src/app/context/AppContext.jsx'; import {PortalPage} from '/src/app/components/portal/PortalPage.jsx';
        import {CustomerProfile} from '/src/app/components/CustomerProfile.jsx'; import '/src/styles/index.css';
        function Root() {const {currentUser} = useApp(); const customer = currentUser.role === 'customer';
          return React.createElement(MemoryRouter, {key: currentUser.role, initialEntries: [customer ? '/customer/dashboard?tab=appointments' : '/portal/appointments']}, React.createElement(customer ? CustomerProfile : PortalPage));}
        createRoot(document.getElementById('root')).render(React.createElement(Root));`;
    },
    configureServer(vite) {
      vite.middlewares.use((req, res, next) => {
        if (req.url !== "/__appointment_test") return next();
        res.setHeader("Content-Type", "text/html");
        res.end('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="background:#f6f0e7;padding:16px"><div id="root"></div><script type="module" src="/__appointment_entry.js"></script></body></html>');
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
  await page.goto(`${server.resolvedUrls.local[0]}__appointment_test`);
  await page.locator(".fc-event").first().waitFor();
  assert.equal(await page.locator(".fc-event").count(), 8);
  await page.getByLabel("Filter managed appointments by status").selectOption("Pending");
  const list = page.getByRole("heading", { name: "Manage appointments", exact: true }).locator("xpath=ancestor::section[1]");
  const names = await list.locator("button").allTextContents();
  assert.ok(names[0].includes("Earlier") && names[1].includes("Later"), "Pending bookings must be chronological");
  assert.equal(await page.locator(".fc-event").count(), 8, "List filters must not hide appointments from the calendar");
  await mkdir("artifacts/appointment-views", { recursive: true });
  await page.screenshot({ path: "artifacts/appointment-views/staff-desktop.png", fullPage: true });
  await page.locator('.appointment-calendar .fc-event[title*="Earlier"]').click();
  const dialog = page.getByRole("dialog", { name: "Appointment details", exact: true });
  await dialog.waitFor();
  const completion = dialog.getByRole("checkbox", { name: "Mark appointment completed" });
  assert.ok(await completion.isDisabled());
  await dialog.locator("select").selectOption("Staff A");
  assert.ok(await dialog.getByRole("button", { name: "Approve appointment" }).isEnabled());
  page.once("dialog", (prompt) => prompt.accept());
  await dialog.getByRole("button", { name: "Approve appointment" }).click();
  await completion.waitFor();
  await page.waitForFunction(() => !document.querySelector('dialog input[type="checkbox"]').disabled);
  page.once("dialog", (prompt) => prompt.accept());
  await completion.check();
  await page.waitForFunction(() => document.querySelector('dialog input[type="checkbox"]').disabled);
  await dialog.getByRole("button", { name: "Back", exact: true }).click();
  await dialog.waitFor({ state: "hidden" });
  assert.equal(await page.getByLabel("Filter managed appointments by status").inputValue(), "Pending");
  await page.getByRole("button", { name: "Next calendar period" }).click();
  const calendarTitle = await page.locator('.appointment-calendar p[aria-live="polite"]').textContent();
  await list.getByRole("button", { name: /Later/ }).click();
  await dialog.waitFor();
  await dialog.getByRole("button", { name: "Back", exact: true }).click();
  assert.equal(await page.locator('.appointment-calendar p[aria-live="polite"]').textContent(), calendarTitle);
  await page.getByRole("button", { name: "Today", exact: true }).click();
  await page.getByRole("button", { name: "Week", exact: true }).click();
  assert.equal(await page.locator(".fc-timeGridWeek-view").count(), 1);
  await page.getByRole("button", { name: "Day", exact: true }).click();
  assert.equal(await page.locator(".fc-timeGridDay-view").count(), 1);
  await page.getByRole("button", { name: "Month", exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForFunction(() => {
    const calendar = document.querySelector('.appointment-calendar').getBoundingClientRect();
    const header = [...document.querySelectorAll('.fc-col-header-cell')].at(-1).getBoundingClientRect();
    return header.right <= calendar.right;
  });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
  await page.screenshot({ path: "artifacts/appointment-views/staff-mobile.png", fullPage: true });
  await list.getByRole("button", { name: /Later/ }).click();
  await dialog.waitFor();
  const bounds = await dialog.boundingBox();
  assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= 391);
  await page.screenshot({ path: "artifacts/appointment-views/pending-mobile-popup.png" });
  await page.keyboard.press("Escape");
  await dialog.waitFor({ state: "hidden" });
  await page.evaluate(() => window.__appointmentRole("customer"));
  await page.getByLabel("Filter my appointments by status").waitFor();
  const customerList = page.getByRole("heading", { name: "My appointments", exact: true }).locator("xpath=ancestor::section[1]");
  assert.equal(await customerList.locator("button").filter({ has: page.locator("h3") }).count(), 3);
  assert.deepEqual(await customerList.locator("button h3").allTextContents(), ["Earlier", "Green", "Finished"]);
  await page.getByRole("button", { name: "Next appointments", exact: true }).click();
  assert.equal(await customerList.locator("button").filter({ has: page.locator("h3") }).count(), 3);
  await page.getByLabel("Filter my appointments by status").selectOption("Approved");
  assert.equal(await customerList.locator("button").filter({ has: page.locator("h3") }).count(), 2);
  await page.getByLabel("Search my appointments").fill("Green");
  assert.equal(await customerList.locator("button").filter({ has: page.locator("h3") }).count(), 1);
  await page.getByLabel("Search my appointments").fill("no-such-pet");
  await page.getByRole("heading", { name: "No matching appointments", exact: true }).waitFor();
  await page.getByLabel("Search my appointments").fill("");
  await page.getByLabel("Filter my appointments by status").selectOption("All");
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
  await page.screenshot({ path: "artifacts/appointment-views/customer-mobile.png", fullPage: true });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({ path: "artifacts/appointment-views/customer-desktop.png", fullPage: true });
  assert.deepEqual(errors, []);
  console.log("Appointment browser checks passed: pagination, filters, pending order, calendar views, popup actions, approved-only completion and mobile layout.");
} finally {
  await browser?.close();
  await server.close();
}
