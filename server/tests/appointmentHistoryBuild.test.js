const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { app } = require("../src/app");

test("the production server serves appointment History instead of the obsolete account-log History bundle", async () => {
  const projectRoot = path.resolve(__dirname, "../..");
  const dist = fs.existsSync(path.join(projectRoot, "server/dist/index.html"))
    ? path.join(projectRoot, "server/dist") : path.join(projectRoot, "dist");
  const bundles = fs.readdirSync(path.join(dist, "assets")).filter(name => /^PortalPage-.*\.js$/.test(name));
  assert.equal(bundles.length, 1, "Build the frontend with npm --prefix server run build before testing production assets.");
  const server = app.listen(0, "127.0.0.1");
  await new Promise(resolve => server.once("listening", resolve));
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/assets/${bundles[0]}`);
    assert.equal(response.status, 200);
    const bundle = await response.text();
    assert.ok(bundle.includes("Completed, rejected, cancelled, and no-show appointment events visible to your role."));
    assert.ok(!bundle.includes("Customer account and appointment events visible to your role."));
    assert.ok(!bundle.includes("Customer registrations and booking activity will appear here automatically."));
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});
