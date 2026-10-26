import { test, after } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { createServer } from "vite";

const previousDocument = globalThis.document;
globalThis.__employeeSecurityUi = { currentUser: { id: "admin", uid: "admin", role: "admin", name: "Account Holder" },
  visibleNotifications: [{ id: "account", title: "Admin account created", message: "Account creation log", readBy: [] }],
  state: { users: [], appointments: [{ id: "finished", petName: "Milo", service: "Grooming", status: "Completed",
    lifecycleEvents: [{ status: "Completed", actorName: "Staff A", createdAt: "2030-01-01T12:00:00Z" }] }] } };
const server = await createServer({ configFile: false, server: { middlewareMode: true }, appType: "custom", logLevel: "silent",
  plugins: [{ name: "employee-security-fixture", enforce: "pre",
    resolveId(source) {
      if (source === "/__security_portal.js") return "\0security-portal";
      if (source.endsWith("context/AppContext.jsx")) return "\0security-app";
      if (source.endsWith("context/AuthContext.jsx")) return "\0security-auth";
      if (source.endsWith("context/ToastContext.jsx")) return "\0security-toast";
    },
    transform(code, id) {
      if (id.endsWith("EmployeeSaveConfirmation.jsx")) return code.replace('from "react-dom"', 'from "/__security_portal.js"');
    },
    load(id) {
      if (id === "\0security-portal") return "export const createPortal = children => children;";
      if (id === "\0security-app") return "export const useApp = () => globalThis.__employeeSecurityUi;";
      if (id === "\0security-auth") return "export const useAuth = () => ({currentUser: globalThis.__employeeSecurityUi.currentUser});";
      if (id === "\0security-toast") return "export const useToast = () => ({error() {}, success() {}});";
    },
  }],
});
after(async () => { await server.close(); globalThis.document = previousDocument; delete globalThis.__employeeSecurityUi; });
const { EmployeeSaveConfirmation } = await server.ssrLoadModule("/src/app/components/portal/EmployeeSaveConfirmation.jsx");
const { PortalPage } = await server.ssrLoadModule("/src/app/components/portal/PortalPage.jsx");
globalThis.document = { body: {} };

test("every employee mutation prompts for the holder's password; new password follows Role in the modal", () => {
  for (const mode of ["create", "update", "delete", "status"]) {
    const html = renderToString(createElement(EmployeeSaveConfirmation, { pendingSave: { mode,
      fullPayload: { name: "Target", email: "target@example.com", username: "target", role: "staff", password: "Target!Password" } },
      isSaving: false, error: "Current password is incorrect", onConfirm() {}, onCancel() {}, onNewPasswordChange() {} }));
    assert.match(html, /Your current password/);
    assert.match(html, /required=""[^>]*type="password"[^>]*autoComplete="current-password"/);
    assert.match(html, /role="alert"/);
    assert.match(html, /type="submit" disabled=""/);
    if (mode === "update") {
      assert.ok(html.indexOf("Role") < html.indexOf("New password"));
      assert.ok(html.indexOf("New password") < html.indexOf("Your current password"));
    }
  }
});

test("admin and staff appointment History renders lifecycle records and omits account creation logs", () => {
  const state = globalThis.__employeeSecurityUi.state;
  state.appointments = [state.appointments[0],
    ...["Rejected", "Cancelled", "No Show", "Pending", "Confirmed"].map(status => ({
      id: status, petName: `Pet ${status}`, service: "Vaccination", status,
      updatedAt: "2030-01-02T12:00:00Z",
    })),
  ];
  for (const role of ["admin", "staff"]) {
    globalThis.__employeeSecurityUi.currentUser.role = role;
    const html = renderToString(createElement(MemoryRouter, { initialEntries: ["/portal/appointments"] }, createElement(PortalPage)));
    const historyStart = html.indexOf(">History</h3>");
    assert.ok(historyStart >= 0);
    const history = html.slice(historyStart);
    assert.match(history, /Milo/);
    assert.match(history, /Staff A/);
    for (const status of ["Rejected", "Cancelled", "No Show"]) assert.ok(history.includes(`Pet ${status}`));
    assert.ok(!history.includes("Pet Pending"));
    assert.ok(!history.includes("Pet Confirmed"));
    assert.ok(!history.includes("Admin account created"));
    assert.ok(!history.includes("Account creation log"));
  }
});
