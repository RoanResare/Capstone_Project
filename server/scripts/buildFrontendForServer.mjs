import { cpSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const serverRoot = resolve(import.meta.dirname, "..");
const projectRoot = resolve(serverRoot, "..");
const frontendDist = join(projectRoot, "dist");
const serverDist = join(serverRoot, "dist");
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";

function run(command, args, cwd) {
  const result = spawnSync(command, args, {
    cwd,
    stdio: "inherit",
    shell: process.platform === "win32",
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    process.exit(result.status || 1);
  }
}

if (!existsSync(join(projectRoot, "node_modules", ".bin", "vite"))) {
  run(npmCommand, ["install", "--no-audit", "--no-fund"], projectRoot);
}

run(npmCommand, ["run", "build"], projectRoot);

if (!existsSync(join(frontendDist, "index.html"))) {
  throw new Error(`Frontend build did not produce ${join(frontendDist, "index.html")}.`);
}

cpSync(frontendDist, serverDist, { recursive: true, force: true });
console.info(`[build] Frontend bundle copied to ${serverDist}`);
