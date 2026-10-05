import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, test } from "node:test";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { createServer } from "vite";

const mocks = {
  "./services/sessionSecurity.js": "export async function verifyActiveSessionSecurity() {}",
  "./context/AuthContext.jsx": `export const AuthProvider = ({ children }) => children;
    export function useAuth() { return { currentUser: globalThis.__dashboardTestUser, signOut() {} }; }`,
  "./context/AppContext.jsx": "export const AppProvider = ({ children }) => children;",
  "./context/ToastContext.jsx": `export const ToastProvider = ({ children }) => children;
    export function useToast() { return { info() {} }; }`,
  "./routes.jsx": `import { createElement } from 'react';
    import { createMemoryRouter } from 'react-router-dom';
    export const router = createMemoryRouter([{ path: '*', element: createElement('main', null, 'Dashboard content') }]);`,
};
const server = await createServer({
  configFile: false, server: { middlewareMode: true }, appType: "custom", logLevel: "silent",
  plugins: [{ name: "dashboard-session-test", enforce: "pre",
    resolveId(source) { if (source in mocks) return `\0dashboard-session:${source}`; },
    load(id) { if (id.startsWith("\0dashboard-session:")) return mocks[id.slice("\0dashboard-session:".length)]; },
  }],
});
after(async () => { await server.close(); delete globalThis.__dashboardTestUser; });
const { default: App } = await server.ssrLoadModule("/src/app/App.jsx");

test("authenticated dashboards render immediately for all roles without a connection gate", () => {
  for (const role of ["customer", "admin", "staff"]) {
    globalThis.__dashboardTestUser = { uid: role, role };
    const html = renderToString(createElement(App));
    assert.match(html, /Dashboard content/);
    assert.doesNotMatch(html, /Verifying your connection/);
  }
});

test("silent network monitoring is mounted without a connection gate; inactivity timeout remains", () => {
  for (const file of ["App.jsx", "services/customerAccount.js", "services/firebaseAuth.js", "services/scheduleData.js"]) {
    const source = readFileSync(new URL(`../src/app/${file}`, import.meta.url), "utf8");
    assert.doesNotMatch(source, /SessionSecurityGuard|Verifying your connection/);
  }
  const app = readFileSync(new URL("../src/app/App.jsx", import.meta.url), "utf8");
  assert.match(app, /INACTIVITY_LIMIT_MS = 30 \* 60 \* 1000/);
  assert.match(app, /<InactivityGuard \/>/);
  assert.match(app, /verifyActiveSessionSecurity/);
  assert.match(app, /monitorSessionSecurity/);
  assert.match(app, /<SessionSecurityMonitor \/>/);
});
