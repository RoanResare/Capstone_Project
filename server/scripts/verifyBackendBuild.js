const { existsSync } = require("node:fs");
const { resolve } = require("node:path");
const { spawnSync } = require("node:child_process");

const serverRoot = resolve(__dirname, "..");
const backendEntryPoints = [
  "server.js",
  "src/server.js",
  "src/app.js",
];

for (const relativePath of backendEntryPoints) {
  const filePath = resolve(serverRoot, relativePath);
  if (!existsSync(filePath)) {
    throw new Error(`[build] Required backend file is missing: ${relativePath}`);
  }

  const result = spawnSync(process.execPath, ["--check", filePath], { stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
}

console.info("[build] Backend syntax verified. Frontend build variables are not required by the API service.");
