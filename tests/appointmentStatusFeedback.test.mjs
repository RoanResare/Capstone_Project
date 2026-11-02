import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { canChangeAppointmentStatus } from "../src/app/utils/appointmentActions.js";

function fixture({ failSave = false, failRefresh = false, emailNotification = { state: "pending" } } = {}) {
  const source = readFileSync(new URL("../src/app/components/portal/PortalPage.jsx", import.meta.url), "utf8");
  const start = source.indexOf("  const handleAppointmentUpdate = async (appointmentId, updates) => {");
  const end = source.indexOf("  const filteredAppointments", start);
  assert.ok(start > 0 && end > start);
  const toasts = [], calls = [];
  const context = { appointments: [{ id: "appointment", status: "Pending" }], currentUser: { name: "Staff" }, canChangeAppointmentStatus,
    toast: { success: message => toasts.push({ type: "success", message }), error: message => toasts.push({ type: "error", message }) },
    updateAppointment: async (...args) => { calls.push(args); if (failSave) throw new Error("commit failed"); return { ok: true, emailNotification }; },
    refreshScheduleData: async () => { if (failRefresh) throw new Error("refresh failed"); },
  };
  vm.runInNewContext(`${source.slice(start, end)}\nglobalThis.update = handleAppointmentUpdate;`, context);
  return { update: context.update, toasts, calls };
}

// The existing staff UI submits Accepted for approval; the backend also accepts Approved.
for (const status of ["Accepted", "Rejected", "Cancelled"]) {
  test(`${status} displays one accurate queued notification message`, async () => {
    const app = fixture(); assert.equal(await app.update("appointment", { status }), true);
    assert.equal(app.toasts.length, 1); assert.equal(app.toasts[0].type, "success");
    assert.match(app.toasts[0].message, /Customer email notification is pending\./);
    assert.equal(app.toasts[0].message.includes("notification sent"), false);
  });
}
test("failed status decisions show no queued or delivered success", async () => {
  const app = fixture({ failSave: true }); assert.equal(await app.update("appointment", { status: "Accepted" }), false);
  assert.equal(app.toasts.length, 1); assert.equal(app.toasts[0].type, "error");
});
test("refresh failure after commit cannot add a misleading failure toast", async () => {
  const app = fixture({ failRefresh: true }); assert.equal(await app.update("appointment", { status: "Accepted" }), true);
  assert.equal(app.toasts.length, 1); assert.equal(app.toasts[0].type, "success");
});
test("ordinary field edits do not display a decision or email toast", async () => {
  const app = fixture({ emailNotification: null }); await app.update("appointment", { assignedStaff: "Staff" });
  assert.equal(app.toasts.length, 0);
});
