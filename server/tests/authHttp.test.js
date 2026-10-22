const { test } = require("node:test");
const assert = require("node:assert/strict");
const { app } = require("../src/app");

test("auth endpoints allow frontend preflights and reject malformed JSON consistently", async () => {
  const server = app.listen(0, "127.0.0.1");
  await new Promise(resolve => server.once("listening", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const origin = "https://www.charmingfurfectionpetscareservices.online";
  try {
    for (const route of ["/admin/verify-otp", "/staff/verify-otp", "/admin/send-otp",
      "/staff/send-otp", "/auth/forgot-password", "/auth/validate-reset-code", "/auth/reset-password",
      "/auth/register/activate"]) {
      const preflight = await fetch(`${base}/api${route}`, { method: "OPTIONS", headers: {
        Origin: origin, "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "content-type",
      } });
      assert.equal(preflight.status, 204, route);
      assert.equal(preflight.headers.get("access-control-allow-origin"), origin);
      const response = await fetch(`${base}/api${route}`, { method: "POST", headers: {
        Origin: origin, "Content-Type": "application/json",
      }, body: "{" });
      assert.equal(response.status, 400, route);
      assert.equal(response.headers.get("access-control-allow-origin"), origin);
      assert.equal((await response.json()).success, false);
    }
    const page = await fetch(`${base}/verify-otp`);
    const csp = page.headers.get("content-security-policy");
    assert.match(csp, /connect-src[^;]*https:\/\/firestore.googleapis.com/);
    assert.match(csp, /connect-src[^;]*https:\/\/identitytoolkit.googleapis.com/);
    assert.match(csp, /connect-src[^;]*https:\/\/securetoken.googleapis.com/);
    assert.match(csp, /img-src[^;]*https:\/\/www.google.com/);
    await page.arrayBuffer();
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});
