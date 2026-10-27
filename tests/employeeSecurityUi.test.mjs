import { test, after } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { createServer } from "vite";
import { readFileSync } from "node:fs";
import { getPasswordPolicyError } from "../src/app/utils/passwordPolicy.js";

const previousDocument = globalThis.document;
globalThis.__employeeSecurityUi = { currentUser: { id: "admin", uid: "admin", role: "admin", name: "Account Holder" },
  visibleNotifications: [{ id: "account", title: "Admin account created", message: "Account creation log", readBy: [] }],
  state: { users: [], appointments: [{ id: "finished", petName: "Milo", service: "Grooming", status: "Completed",
    lifecycleEvents: [{ status: "Completed", actorName: "Staff A", createdAt: "2030-01-01T12:00:00Z" }] }] } };
const server = await createServer({ configFile: false, server: { middlewareMode: true }, appType: "custom", logLevel: "silent",
  plugins: [{ name: "employee-security-fixture", enforce: "pre",
    resolveId(source) {
      if (source === "/__security_portal.js") return "\0security-portal";
      if (source === "/__employee_hooks.js") return "\0employee-hooks";
      if (source.endsWith("context/AppContext.jsx")) return "\0security-app";
      if (source.endsWith("context/AuthContext.jsx")) return "\0security-auth";
      if (source.endsWith("context/ToastContext.jsx")) return "\0security-toast";
    },
    transform(code, id) {
      if (id.endsWith("EmployeeSaveConfirmation.jsx")) return code.replace('from "react-dom"', 'from "/__security_portal.js"')
        .replace('from "react"', 'from "/__employee_hooks.js"');
    },
    load(id) {
      if (id === "\0security-portal") return "export const createPortal = children => children;";
      if (id === "\0employee-hooks") return `import * as React from 'react';
        export const useState = initial => globalThis.__employeeHooks ? globalThis.__employeeHooks.useState(initial) : React.useState(initial);
        export const useRef = initial => globalThis.__employeeHooks ? {current: initial} : React.useRef(initial);
        export const useEffect = (...args) => { if (!globalThis.__employeeHooks) React.useEffect(...args); };`;
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

test("employee saves request only a new password; status and deletion retain holder confirmation", () => {
  for (const mode of ["create", "update", "delete", "status"]) {
    const html = renderToString(createElement(EmployeeSaveConfirmation, { pendingSave: { mode,
      fullPayload: { name: "Target", email: "target@example.com", username: "target", role: "staff", password: "Target!Password" } },
      isSaving: false, error: "Current password is incorrect", onConfirm() {}, onCancel() {}, onNewPasswordChange() {} }));
    assert.match(html, /role="alert"/);
    if (["create", "update"].includes(mode)) {
      assert.doesNotMatch(html, /Your current password|autoComplete="current-password"/);
      assert.ok(html.indexOf("Role") < html.indexOf("New password"));
      assert.doesNotMatch(html, /type="submit" disabled=""/);
      assert.match(html, /autoComplete="new-password"/);
      assert.match(html, /aria-label="Show new password"/);
      assert.match(html, /id="employee-new-password"[^>]*class="block w-full/);
    } else {
      assert.match(html, /Your current password/);
      assert.match(html, /required=""[^>]*type="password"[^>]*autoComplete="current-password"/);
      assert.match(html, /type="submit" disabled=""/);
    }
  }
});

test("new password visibility toggles both ways and typing updates the pending employee password", () => {
  const values = [];
  let cursor = 0;
  globalThis.__employeeHooks = { useState(initial) {
    const index = cursor++;
    if (!(index in values)) values[index] = initial;
    return [values[index], next => { values[index] = typeof next === "function" ? next(values[index]) : next; }];
  } };
  const props = { pendingSave: { mode: "update", fullPayload: { password: "Original!" } },
    isSaving: false, onNewPasswordChange: password => { props.pendingSave.fullPayload.password = password; } };
  const render = () => { cursor = 0; return EmployeeSaveConfirmation(props); };
  const find = (node, predicate) => {
    if (!node || typeof node !== "object") return null;
    if (predicate(node)) return node;
    for (const child of [node.props?.children].flat(Infinity)) {
      const found = find(child, predicate); if (found) return found;
    }
    return null;
  };
  try {
    let tree = render();
    const input = () => find(tree, node => node.props?.id === "employee-new-password");
    const toggle = () => find(tree, node => node.props?.["aria-controls"] === "employee-new-password");
    assert.equal(input().props.type, "password");
    assert.equal(toggle().props.type, "button");
    assert.equal(toggle().props.disabled, false);
    toggle().props.onClick(); tree = render();
    assert.equal(input().props.type, "text");
    assert.equal(toggle().props["aria-label"], "Hide new password");
    input().props.onChange({ target: { value: "Replacement!" } }); tree = render();
    assert.equal(input().props.value, "Replacement!");
    toggle().props.onClick(); tree = render();
    assert.equal(input().props.type, "password");
    assert.equal(input().props.value, "Replacement!");
    props.isSaving = true; tree = render();
    assert.equal(toggle().props.disabled, true);
  } finally { delete globalThis.__employeeHooks; }
});

test("confirmation validates password before invoking employee create or update", async () => {
  const source = readFileSync(new URL("../src/app/components/portal/PortalPage.jsx", import.meta.url), "utf8");
  const start = source.indexOf("  const confirmSaveUser = async () => {");
  const handler = source.slice(start, source.indexOf("  const handleDelete =", start));
  for (const mode of ["create", "update"]) {
    for (const password of ["", "weak", "Valid123!"]) {
      let requests = 0;
      let feedback;
      const ports = {
        pendingUserSave: { mode, userId: "employee", fullPayload: { password }, payload: { password } },
        isSaving: false, getPasswordPolicyError,
        setFeedback: value => { feedback = value; }, setIsSaving() {},
        // Stop after the API returns so this test isolates validation and submission.
        createStaff: async () => { requests++; return { ok: false, error: "API reached" }; },
        updateUser: async () => { requests++; return { ok: false, error: "API reached" }; },
      };
      const confirm = new Function(...Object.keys(ports), `${handler}\nreturn confirmSaveUser;`)(...Object.values(ports));
      await confirm();
      const valid = password === "Valid123!" || (mode === "update" && !password);
      assert.equal(requests, valid ? 1 : 0, `${mode}: ${password || "blank"}`);
      assert.equal(feedback.type, "error");
      if (valid) assert.equal(feedback.message, "API reached");
      else assert.match(feedback.message, /password/i);
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
    const cardText = history.replace(/<!--.*?-->/g, "");
    assert.ok(cardText.includes("Milo | Grooming"));
    assert.ok(!cardText.includes("Milo ? Grooming"));
    for (const status of ["Rejected", "Cancelled", "No Show"]) {
      assert.ok(cardText.includes(`Pet ${status} | Vaccination`));
      assert.ok(!cardText.includes(`Pet ${status} ? Vaccination`));
    }
    assert.match(history, /Milo/);
    assert.match(history, /Staff A/);
    for (const status of ["Rejected", "Cancelled", "No Show"]) assert.ok(history.includes(`Pet ${status}`));
    assert.ok(!history.includes("Pet Pending"));
    assert.ok(!history.includes("Pet Confirmed"));
    assert.ok(!history.includes("Admin account created"));
    assert.ok(!history.includes("Account creation log"));
  }
});
