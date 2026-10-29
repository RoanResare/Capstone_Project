const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

test("host credentials take precedence while server env overrides root defaults", () => {
  const processEnv = { EMAIL_PASS: "updated-host-password" };
  const context = {
    __dirname: path.resolve(__dirname, "../src/config"),
    process: { env: processEnv }, module: { exports: {} },
    require(id) {
      if (id === "fs") return { existsSync: () => true };
      if (id === "path") return path;
      if (id === "dotenv") return { config(options) {
        const parsed = options.path.endsWith(path.join("server", ".env"))
          ? { EMAIL_USER: "server@example.test", EMAIL_PASS: "stale-server-password" }
          : { EMAIL_USER: "root@example.test", EMAIL_PASS: "stale-root-password" };
        Object.assign(options.processEnv, parsed);
        return { parsed };
      } };
      throw new Error(id);
    },
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "../src/config/loadEnv.js"), "utf8"), context);
  context.module.exports.loadEnvFiles();
  assert.equal(processEnv.EMAIL_PASS, "updated-host-password");
  assert.equal(processEnv.EMAIL_USER, "server@example.test");
  context.module.exports.loadEnvFiles();
  assert.equal(processEnv.EMAIL_PASS, "updated-host-password");
});
