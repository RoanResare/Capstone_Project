import assert from "node:assert/strict";
import { after, test } from "node:test";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { matchRoutes, MemoryRouter } from "react-router-dom";
import { createServer } from "vite";
import { canAccessPath, resolveAuthorizedPath, resolveHomePath } from "../src/app/utils/roleUtils.js";
import { isValidPortalSessionRoute } from "../src/app/utils/portalRouteSecurity.js";

const server = await createServer({
  configFile: false,
  server: { middlewareMode: true },
  appType: "custom",
  logLevel: "silent",
  plugins: [{
    name: "routing-test-context",
    enforce: "pre",
    resolveId(source) {
      if (source.endsWith("context/AuthContext.jsx")) return "\0routing-test-auth";
      if (source.endsWith("AskLlamaAI.jsx")) return "\0routing-test-assistant";
    },
    load(id) {
      if (id === "\0routing-test-auth") return "export function useAuth() { return globalThis.__routingTestAuth; }";
      if (id === "\0routing-test-assistant") return "export function AskLlamaAI() { return null; }";
    },
    transform(code, id) {
      if (id.replaceAll("\\", "/").endsWith("/src/app/routes.jsx")) {
        return code.replaceAll("createBrowserRouter", "createMemoryRouter");
      }
    },
  }],
});
after(async () => {
  await server.close();
  delete globalThis.__routingTestAuth;
});

const { Layout } = await server.ssrLoadModule("/src/app/components/Layout.jsx");
const { PortalSessionRouteGuard } = await server.ssrLoadModule("/src/app/components/portal/PortalSessionRouteGuard.jsx");
const { RequireAuth } = await server.ssrLoadModule("/src/app/components/portal/RequireAuth.jsx");
const { router } = await server.ssrLoadModule("/src/app/routes.jsx");
after(() => router.dispose());

function renderAt(path, component) {
  return renderToString(createElement(MemoryRouter, { initialEntries: [path] }, component));
}

test("authentication becoming ready on public login and OTP pages never renders security logout", () => {
  for (const role of ["customer", "admin", "staff"]) {
    let logoutCalls = 0;
    globalThis.__routingTestAuth = { currentUser: { uid: `${role}-id`, role },
      isLoading: false, isAuthenticated: true, signOut() { logoutCalls += 1; } };
    for (const path of ["/login", "/admin/login", "/staff/login", "/verify-otp", "/dashboard", "/unauthorized", "/"]) {
      const html = renderAt(path, createElement(Layout));
      assert.equal(html.includes("Security Logout"), false, `${role} at ${path}`);
      assert.equal(html.includes("requested portal address"), false, `${role} at ${path}`);
    }
    assert.equal(logoutCalls, 0);
  }
});

test("each role resolves to its own dashboard and portal guards accept both login completion paths", () => {
  for (const role of ["customer", "admin", "staff"]) {
    const home = `/${role}/dashboard`;
    const matches = matchRoutes(router.routes, home);
    assert.ok(matches, `Dashboard is registered for ${role}`);
    const dashboard = matches.at(-1).route.element;
    const authGuard = role === "customer" ? dashboard : dashboard.props.children;
    assert.deepEqual(authGuard.props.allowedRoles, [role]);
    assert.equal(resolveHomePath(role), home);
    for (const request of ["", "/login", "/verify-otp", "/portal/not-a-route", "https://example.test", "//example.test"]) {
      assert.equal(resolveAuthorizedPath(role, request), home);
    }
    for (const other of ["customer", "admin", "staff"].filter((value) => value !== role)) {
      assert.equal(resolveAuthorizedPath(role, `/${other}/dashboard`), home);
    }
    const requested = `${home}/?tab=appointments#today`;
    assert.equal(resolveAuthorizedPath(role, requested), requested);
    globalThis.__routingTestAuth = { currentUser: { uid: `${role}-id`, role },
      isLoading: false, isAuthenticated: true, signOut() { assert.fail("Unexpected logout"); } };
    const protectedDashboard = createElement(RequireAuth, { allowedRoles: [role] },
      createElement("p", null, `${role} dashboard`));
    const html = renderAt(home, role === "customer" ? protectedDashboard
      : createElement(PortalSessionRouteGuard, null, protectedDashboard));
    assert.equal(html.includes(`${role} dashboard`), true);
    assert.equal(html.includes("Security Logout"), false);
  }
});

test("return destinations agree with registered routes and preserve role restrictions", () => {
  for (const role of ["admin", "staff"]) {
    for (const path of ["/portal", "/portal/appointments", "/portal/schedule", "/portal/pet-records"]) {
      const requested = `${path}/?filter=pending#details`;
      assert.equal(resolveAuthorizedPath(role, requested), requested);
      assert.equal(isValidPortalSessionRoute(role, path), true);
    }
    assert.equal(canAccessPath(role, "/portal/appointments/unknown"), false);
    assert.equal(isValidPortalSessionRoute(role, "/portal/unknown"), false);
    assert.equal(canAccessPath(role, "/portal/photo-moderation"), false);
    assert.equal(resolveAuthorizedPath(role, "/portal/photo-moderation"), resolveHomePath(role));
  }
  assert.equal(canAccessPath("staff", "/portal/manage-users"), false);
  assert.equal(canAccessPath("staff", "/portal/admin/users"), false);
  assert.equal(canAccessPath("admin", "/portal/manage-users"), true);
  assert.equal(canAccessPath("admin", "/portal/admin/users"), true);
  assert.equal(canAccessPath("customer", "/customer/dashboard/../../admin/dashboard"), false);
  assert.equal(canAccessPath("staff", "/portal/appointments/../manage-users"), false);
  // Recognized routes reach RequireAuth for access denial rather than destroying the session.
  assert.equal(isValidPortalSessionRoute("staff", "/portal/manage-users"), true);
  assert.equal(isValidPortalSessionRoute("staff", "/admin/dashboard"), true);
});
