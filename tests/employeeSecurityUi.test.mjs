import { test, after } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { createServer } from "vite";
import { readFileSync } from "node:fs";
import { getPasswordPolicyError } from "../src/app/utils/passwordPolicy.js";
import { isValidUsername, normalizeUsername, USERNAME_POLICY_MESSAGE } from "../src/app/utils/usernamePolicy.js";

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
      if (id.endsWith("PortalPage.jsx")) return `${code}\nexport { ManageUsersWorkspace };`;
      if (id.endsWith("EmployeePasswordInput.jsx")) return code.replace('from "react"', 'from "/__employee_hooks.js"');
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
const { EmployeePasswordInput } = await server.ssrLoadModule("/src/app/components/portal/EmployeePasswordInput.jsx");
const { PortalPage, ManageUsersWorkspace } = await server.ssrLoadModule("/src/app/components/portal/PortalPage.jsx");
globalThis.document = { body: {} };

test("employee save confirmation summarizes changed fields without password inputs or duplicated errors", () => {
  for (const mode of ["create", "update", "delete", "status"]) {
    const html = renderToString(createElement(EmployeeSaveConfirmation, { pendingSave: { mode,
      fullPayload: { name: "Target", email: "target@example.com", username: "target", role: "staff", password: "Target!Password" },
      payload: mode === "update" ? { name: "Target", password: "Target!Password" } : { name: "Target", email: "target@example.com", username: "target", role: "staff", password: "Target!Password" } },
      isSaving: false, error: "Current password is incorrect", onConfirm() {}, onCancel() {}, onNewPasswordChange() {} }));
    assert.doesNotMatch(html, /autoComplete="current-password"|autoComplete="new-password"|role="alert"|Current password is incorrect|Target!Password/);
    if (["create", "update"].includes(mode)) {
      assert.match(html, /Confirm Employee Changes/);
      assert.match(html, /Review the changes before saving\./);
      assert.match(html, /Employee: <!-- -->Target/);
      assert.match(html, /target@example\.com/);
      assert.match(html, /Password will be updated/);
      assert.match(html, />Name</);
      if (mode === "update") assert.doesNotMatch(html, />\s*(Email|Username|Role)\s*<\/dt/);
      assert.match(html, /Confirm Changes/);
      assert.match(html, />Cancel</);
      assert.doesNotMatch(html, /type="submit" disabled=""/);
    } else {
      assert.match(html, /Confirm permanent deletion|Confirm status change/);
      assert.doesNotMatch(html, /Your current password/);
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
  const props = { id: "employee-new-password", value: "Original!", disabled: false,
    onChange: password => { props.value = password; } };
  const render = () => { cursor = 0; return EmployeePasswordInput(props); };
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
    props.disabled = true; tree = render();
    assert.equal(toggle().props.disabled, true);
  } finally { delete globalThis.__employeeHooks; }
});

test("create and edit forms keep separate new and current admin password controls", () => {
  const source = readFileSync(new URL("../src/app/components/portal/PortalPage.jsx", import.meta.url), "utf8");
  const employee = { id: "employee", name: "Employee", email: "employee@example.com", username: "employee", role: "staff", status: "active" };
  const props = { currentUser: { id: "admin", role: "admin" }, state: { users: [employee] }, visibleNotifications: [] };
  for (const [id, creating] of [["__new-portal-user__", true], ["employee", false]]) {
    const html = renderToString(createElement(MemoryRouter, { initialEntries: [`/portal/manage-users?user=${id}`] },
      createElement(ManageUsersWorkspace, props)));
    if (creating) {
      assert.match(html, /Create employee account/);
      assert.match(html, /id="employee-create-password"[^>]*autoComplete="new-password"/);
    } else {
      assert.match(html, /Employee Information/);
      assert.match(html, /Update the employee(?:&#x27;|')s information, password, and role\./);
      assert.match(html, />Name</);
      assert.match(html, />Email</);
      assert.match(html, />Username</);
      assert.match(html, />Role</);
      assert.match(html, /New Password/);
      assert.match(html, /class="min-w-0 md:col-span-2"/);
      assert.match(html, /id="employee-edit-password"[^>]*class="block w-full/);
      assert.match(html, /aria-controls="employee-edit-password"/);
      assert.equal((html.match(/autoComplete="new-password"/g) || []).length, 1);
      assert.match(html, /This employee can log in to their account\./);
      assert.match(html, /Save Changes/);
      assert.match(html, /Discard Changes/);
      assert.match(html, /Delete Account/);
    }
    assert.match(html, /Current Admin Password/);
    assert.match(html, /autoComplete="current-password"/);
    assert.match(html, /Enter your own password to confirm these changes\./);
    assert.match(html, /Manage Employee Accounts/);
    assert.match(html, /Add new employees, update their information, and manage their account access\./);
    assert.match(html, /Search employees\.\.\./);
    assert.match(html, /Add employee/);
  }
  assert.match(source, /aria-label=\{`Change status for \$\{user\.name\}`\}/);
  assert.match(source, /onChange=\{\(event\) => setSearchValue\(event\.target\.value\)\}/);
});

test("create action waits for confirmation and includes current admin password only for the API call", async () => {
  const source = readFileSync(new URL("../src/app/components/portal/PortalPage.jsx", import.meta.url), "utf8");
  const start = source.indexOf("  const saveUser = async (event) => {");
  const handler = source.slice(start, source.indexOf("  const confirmSaveUser =", start));
  let pending;
  const ports = {
    isSaving: false, getTextValidationErrors: () => ({}), ACCOUNT_TEXT_FIELDS: [], setTextErrors() {},
    form: { name: "Employee", email: "employee@example.com", username: "test.cstmr2", role: "staff", password: "" },
    isValidEmail: () => true, isCreatingNew: true, selectedUser: null,
    currentAdminPassword: "Admin!Password1", currentAdminPasswordRef: { current: null }, setCurrentAdminPasswordError() {},
    isValidUsername, USERNAME_POLICY_MESSAGE,
    setPendingUserSave: value => { pending = value; }, setFeedback() {},
    createStaff: () => assert.fail("Must wait for modal confirmation"),
  };
  const save = new Function(...Object.keys(ports), `${handler}\nreturn saveUser;`)(...Object.values(ports));
  await save({ preventDefault() {} });
  assert.equal(pending.mode, "create");
  assert.equal(pending.fullPayload.password, "");
  assert.equal(pending.fullPayload.username, "test.cstmr2");
  let missingPending;
  let fieldError;
  let focused = false;
  const missingPasswordPorts = { ...ports, currentAdminPassword: "", currentAdminPasswordRef: { current: { focus() { focused = true; } } },
    setPendingUserSave: value => { missingPending = value; }, setCurrentAdminPasswordError: value => { fieldError = value; } };
  const saveMissingPassword = new Function(...Object.keys(missingPasswordPorts), `${handler}\nreturn saveUser;`)(...Object.values(missingPasswordPorts));
  await saveMissingPassword({ preventDefault() {} });
  assert.equal(missingPending, undefined);
  assert.equal(fieldError, "Enter your own password to confirm these changes.");
  assert.equal(focused, true);
});

test("Manage Users username validation follows the shared policy and allows unchanged dotted names", async () => {
  const source = readFileSync(new URL("../src/app/components/portal/PortalPage.jsx", import.meta.url), "utf8");
  const start = source.indexOf("  const saveUser = async (event) => {");
  const handler = source.slice(start, source.indexOf("  const confirmSaveUser =", start));
  for (const username of ["test.cstmr2", "legacy name"]) {
    const originalForm = { name: "Employee", email: "employee@example.com", username, role: "staff", password: "" };
    const form = { ...originalForm };
    let pending;
    let feedback;
    const ports = {
      isSaving: false, getTextValidationErrors: () => ({}), ACCOUNT_TEXT_FIELDS: [], setTextErrors() {}, form, originalForm,
      isValidEmail: () => true, isCreatingNew: false, selectedUser: { id: "employee" },
      currentAdminPassword: "", currentAdminPasswordRef: { current: null }, setCurrentAdminPasswordError() {},
      isValidUsername, normalizeUsername, USERNAME_POLICY_MESSAGE,
      buildChangedPortalUserPayload: (current, original) => Object.fromEntries(
        ["name", "email", "username", "role"].filter(key => current[key] !== original[key]).map(key => [key, current[key]]),
      ),
      setPendingUserSave: value => { pending = value; }, setFeedback: value => { feedback = value; },
    };
    const save = new Function(...Object.keys(ports), `${handler}\nreturn saveUser;`)(...Object.values(ports));
    await save({ preventDefault() {} });
    assert.equal(pending.mode, "update");
    assert.equal(pending.payload.username, undefined, "unchanged username is omitted from the edit payload");
    assert.equal(feedback.message, "");
  }

  const originalForm = { name: "Employee", email: "employee@example.com", username: "test.cstmr2", role: "staff", password: "" };
  const form = { ...originalForm, username: "bad name" };
  let pending;
  let feedback;
  const invalidPorts = {
    isSaving: false, getTextValidationErrors: () => ({}), ACCOUNT_TEXT_FIELDS: [], setTextErrors() {}, form, originalForm,
    isValidEmail: () => true, isCreatingNew: false, selectedUser: { id: "employee" },
    currentAdminPassword: "", currentAdminPasswordRef: { current: null }, setCurrentAdminPasswordError() {},
    isValidUsername, normalizeUsername, USERNAME_POLICY_MESSAGE,
    buildChangedPortalUserPayload: () => ({}), setPendingUserSave: value => { pending = value; },
    setFeedback: value => { feedback = value; },
  };
  const saveInvalid = new Function(...Object.keys(invalidPorts), `${handler}\nreturn saveUser;`)(...Object.values(invalidPorts));
  await saveInvalid({ preventDefault() {} });
  assert.equal(pending, undefined);
  assert.equal(feedback.message, USERNAME_POLICY_MESSAGE);

  for (const username of ["ab", "a".repeat(25), "bad name", "bad/name"]) {
    assert.equal(isValidUsername(username), false, username);
  }
  assert.equal(isValidUsername("test.cstmr2"), true);
  assert.equal(isValidUsername("under_score-2"), true);
});

test("confirmation validates password before invoking employee create or update", async () => {
  const source = readFileSync(new URL("../src/app/components/portal/PortalPage.jsx", import.meta.url), "utf8");
  const start = source.indexOf("  const confirmSaveUser = async () => {");
  const handler = source.slice(start, source.indexOf("  const handleDelete =", start));
  for (const mode of ["create", "update"]) {
    for (const password of ["", "weak", "Valid123!"]) {
      let requests = 0;
      let feedback;
      let sentPayload;
      const ports = {
        pendingUserSave: { mode, userId: "employee", fullPayload: { password }, payload: { password }, requiresCurrentPassword: true },
        isSaving: false, getPasswordPolicyError, currentAdminPassword: "Admin!Password1", setPendingUserSave() {},
        setFeedback: value => { feedback = value; }, setIsSaving() {},
        // Stop after the API returns so this test isolates validation and submission.
        createStaff: async payload => { requests++; sentPayload = payload; return { ok: false, error: "API reached" }; },
        updateUser: async (_id, payload) => { requests++; sentPayload = payload; return { ok: false, error: "API reached" }; },
      };
      const confirm = new Function(...Object.keys(ports), `${handler}\nreturn confirmSaveUser;`)(...Object.values(ports));
      await confirm();
      const valid = password === "Valid123!" || (mode === "update" && !password);
      assert.equal(requests, valid ? 1 : 0, `${mode}: ${password || "blank"}`);
      assert.equal(feedback.type, "error");
      if (valid) {
        assert.equal(feedback.message, "API reached");
        assert.equal(sentPayload.currentPassword, "Admin!Password1");
      }
      else assert.match(feedback.message, /password/i);
    }
  }
});

test("incorrect admin password closes confirmation and reports the error only beneath its field", async () => {
  const source = readFileSync(new URL("../src/app/components/portal/PortalPage.jsx", import.meta.url), "utf8");
  const start = source.indexOf("  const confirmSaveUser = async () => {");
  const handler = source.slice(start, source.indexOf("  const handleDelete =", start));
  let pendingSave = { mode: "update", userId: "employee", fullPayload: { password: "" }, payload: { role: "admin" }, requiresCurrentPassword: true };
  let fieldError = "";
  let feedback = null;
  let clearedPassword = false;
  let focused = false;
  const ports = {
    pendingUserSave: pendingSave, isSaving: false, getPasswordPolicyError, currentAdminPassword: "wrong",
    setPendingUserSave: value => { pendingSave = value; }, setCurrentAdminPassword: value => { clearedPassword = value === ""; },
    setCurrentAdminPasswordError: value => { fieldError = value; }, setFeedback: value => { feedback = value; }, setIsSaving() {},
    currentAdminPasswordRef: { current: { focus() { focused = true; } } },
    showCurrentAdminPasswordError: message => {
      pendingSave = null;
      clearedPassword = true;
      fieldError = message;
      feedback = { type: "", message: "" };
      requestAnimationFrame(() => ports.currentAdminPasswordRef.current.focus());
    },
    updateUser: async () => ({ ok: false, error: "Your current password is incorrect. No employee changes were saved." }),
  };
  const confirm = new Function(...Object.keys(ports), `${handler}\nreturn confirmSaveUser;`)(...Object.values(ports));
  const priorAnimationFrame = globalThis.requestAnimationFrame;
  globalThis.requestAnimationFrame = callback => callback();
  try { await confirm(); } finally {
    if (priorAnimationFrame) globalThis.requestAnimationFrame = priorAnimationFrame;
    else delete globalThis.requestAnimationFrame;
  }
  assert.equal(pendingSave, null);
  assert.equal(fieldError, "Your current password is incorrect. No employee changes were saved.");
  assert.equal(clearedPassword, true);
  assert.equal(focused, true);
  assert.equal(feedback.message, "");
});

test("status and deletion confirmations keep password verification in the employee form", () => {
  const source = readFileSync(new URL("../src/app/components/portal/PortalPage.jsx", import.meta.url), "utf8");
  assert.match(source, /updateUser\(user\.id, \{ status, currentPassword: currentAdminPassword \}\)/);
  assert.match(source, /deleteUser\(selectedUser\.id, currentAdminPassword\)/);
  assert.match(source, /const requireCurrentAdminPassword = \(\) =>/);
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
