import assert from "node:assert/strict";
import { after, test } from "node:test";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { createServer } from "vite";

const server = await createServer({
  configFile: false,
  server: { middlewareMode: true },
  appType: "custom",
  logLevel: "silent",
  plugins: [{
    name: "appointment-test-context",
    enforce: "pre",
    resolveId(source) {
      if (source.endsWith("context/AppContext.jsx")) return "\0appointment-test-app";
      if (source.endsWith("context/AuthContext.jsx")) return "\0appointment-test-auth";
      if (source.endsWith("context/ToastContext.jsx")) return "\0appointment-test-toast";
    },
    load(id) {
      if (id === "\0appointment-test-app") return "export function useApp() { return globalThis.__appointmentTestApp; }";
      if (id === "\0appointment-test-auth") return "export function useAuth() { return { currentUser: globalThis.__appointmentTestApp.currentUser }; }";
      if (id === "\0appointment-test-toast") return "export function useToast() { return { error() {}, success() {} }; }";
    },
  }],
});
after(async () => {
  await server.close();
  delete globalThis.__appointmentTestApp;
});

const { PortalPage } = await server.ssrLoadModule("/src/app/components/portal/PortalPage.jsx");
const { AppointmentBooking } = await server.ssrLoadModule("/src/app/components/AppointmentBooking.jsx");

function renderAppointment(status, filter = status === "Accepted" ? "Approved" : status) {
  globalThis.__appointmentTestApp = {
    currentUser: { name: "Staff", role: "staff" },
    visibleNotifications: [],
    state: {
      users: [{ name: "Staff", role: "staff", status: "active" }],
      appointments: [{ id: "test", petName: "Test pet", status, assignedStaff: "Staff" }],
    },
  };
  return renderToString(createElement(MemoryRouter, {
    initialEntries: [`/portal/appointments?status=${filter}&appointment=test`],
  }, createElement(PortalPage)));
}

test("appointment categories retain selected details and enforce disabled controls", () => {
  for (const status of ["Pending", "Accepted", "Confirmed", "Completed"]) {
    const html = renderAppointment(status);
    const buttons = [...html.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)];
    const approve = buttons.find(([, , content]) => content.includes("Approve appointment"));
    const reject = buttons.find(([, , content]) => content.includes("Reject appointment"));
    const cancel = buttons.find(([, , content]) => content.includes("Cancel appointment"));
    assert.equal(approve[1].includes('disabled=""'), status !== "Pending", status);
    assert.ok(reject[1].includes('disabled=""'), status);
    assert.ok(cancel[1].includes('disabled=""'), status);
    const completion = html.match(/<input\b[^>]*type="checkbox"[^>]*>/)[0];
    assert.equal(completion.includes('disabled=""'), ["Confirmed", "Completed"].includes(status), status);
    const selectedFilter = [...html.matchAll(/<option\b[^>]*selected=""[^>]*>([^<]*)<\/option>/g)][0][1];
    assert.equal(selectedFilter, status === "Accepted" ? "Approved" : status);
    assert.ok(html.includes("Test pet"));
    assert.ok(!html.includes("No matching appointments"));
  }
});

test("booking offers Add another pet before Add another service", () => {
  globalThis.__appointmentTestApp = {
    currentUser: { uid: "customer", role: "customer", email: "customer@example.com" },
    state: { petRecords: [{ id: "pet", customerId: "customer", petName: "Test pet", petType: "Dog" }] },
  };
  const html = renderToString(createElement(MemoryRouter, null, createElement(AppointmentBooking, { embedded: true })));
  const petButton = html.indexOf("Add another pet");
  const serviceButton = html.indexOf("Add another service");
  assert.ok(petButton >= 0 && serviceButton > petButton);
});
