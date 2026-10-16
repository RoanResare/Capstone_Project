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

function renderAppointment(status, filter = status === "Accepted" ? "Approved" : status, grooming = null, role = "staff") {
  globalThis.__appointmentTestApp = {
    currentUser: { name: "Staff", role },
    visibleNotifications: [],
    state: {
      users: [{ name: "Staff", role: "staff", status: "active" }],
      appointments: [{ id: "test", petName: "Test pet", status, assignedStaff: "Staff", grooming }],
    },
  };
  return renderToString(createElement(MemoryRouter, {
    initialEntries: [`/portal/appointments?status=${filter}&appointment=test`],
  }, createElement(PortalPage)));
}

test("admin and staff see grooming choices before approving pending appointments", () => {
  for (const role of ["admin", "staff"]) {
    const html = renderAppointment("Pending", "Pending", {petType:"Cat",services:[{id:"ear-cleaning",name:"Ear Cleaning"},{id:"nail-clipping",name:"Nail Clipping"}]}, role);
    assert.ok(html.includes("Requested grooming services"));
    assert.ok(html.includes("Ear Cleaning, Nail Clipping"));
    assert.ok(html.includes("Approve appointment"));
    assert.ok(renderAppointment("Pending", "Pending", {petType:"Cat",services:[{id:"feline-full",name:"Full Grooming"}]}, role).includes("Full Grooming"));
  }
  assert.ok(renderAppointment("Pending", "Pending", {name:"Feline Basic Groom",price:500}).includes("Feline Basic Groom"));
});

test("appointment categories retain selected details and enforce disabled controls", () => {
  for (const status of ["Pending", "Accepted", "Confirmed", "Completed"]) {
    const html = renderAppointment(status);
    const buttons = [...html.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)];
    const approve = buttons.find(([, , content]) => content.includes("Approve appointment"));
    const reject = buttons.find(([, , content]) => content.includes("Reject appointment"));
    const cancel = buttons.find(([, , content]) => content.includes("Cancel appointment"));
    assert.equal(approve[1].includes('disabled=""'), status !== "Pending", status);
    assert.equal(reject[1].includes('disabled=""'), status !== "Pending", status);
    assert.equal(cancel[1].includes('disabled=""'), status !== "Pending", status);
    assert.ok(!html.includes("Mark appointment completed"));
    assert.ok(html.includes('aria-label="Appointment details"'));
    const selectedFilter = [...html.matchAll(/<option\b[^>]*selected=""[^>]*>([^<]*)<\/option>/g)][0][1];
    assert.equal(selectedFilter, ["Accepted", "Confirmed"].includes(status) ? "Approved" : status);
    assert.ok(html.includes("Test pet"));
    assert.ok(!html.includes("No matching appointments"));
  }
});

test("Approved category includes Confirmed appointments and hides the Confirmed label", () => {
  const html = renderAppointment("Confirmed", "Approved");
  assert.ok(html.includes("Test pet"));
  assert.ok(!html.includes("No matching appointments"));
  assert.ok(!html.includes(">Confirmed<"));
  assert.ok(html.includes(">Approved<"));
});

test("booking offers an additional service while keeping one pet per booking", () => {
  globalThis.__appointmentTestApp = {
    currentUser: { uid: "customer", role: "customer", email: "customer@example.com" },
    state: { petRecords: [{ id: "pet", customerId: "customer", petName: "Test pet", petType: "Dog" }] },
  };
  const html = renderToString(createElement(MemoryRouter, null, createElement(AppointmentBooking, { embedded: true })));
  const petButton = html.indexOf("Add another pet");
  const serviceButton = html.indexOf("Add another service");
  assert.equal(petButton, -1);
  assert.ok(serviceButton >= 0);
});

test("direct booking with no saved pet does not render a booking form", () => {
  globalThis.__appointmentTestApp = {
    currentUser: { uid: "customer", role: "customer", email: "customer@example.com" },
    state: { petRecords: [] },
  };
  const html = renderToString(createElement(MemoryRouter, null, createElement(AppointmentBooking, { embedded: true })));
  assert.ok(!html.includes("Confirm appointment booking"));
});

test("inactive kapon cannot open the booking form directly", () => {
  globalThis.__appointmentTestApp = {
    currentUser: { uid: "customer", role: "customer", email: "customer@example.com" }, kaponPromoAvailable: false,
    state: { petRecords: [{ id: "pet", customerId: "customer", petName: "Pet" }] },
  };
  const html = renderToString(createElement(MemoryRouter, null, createElement(AppointmentBooking, { embedded: true, initialServiceId: "low-cost-kapon" })));
  assert.ok(!html.includes("Confirm appointment booking"));
  assert.ok(html.includes('role="status"'));
});
