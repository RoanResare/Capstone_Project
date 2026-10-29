import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const serverRoot = resolve(projectRoot, "server");
const serverPackage = JSON.parse(readFileSync(resolve(serverRoot, "package.json"), "utf8"));
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";

function run(args, cwd) {
  const result = spawnSync(npmCommand, args, {
    cwd,
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
}

const missingServerPackages = Object.keys(serverPackage.dependencies || {}).filter(
  (name) => !existsSync(resolve(serverRoot, "node_modules", name, "package.json")),
);

if (missingServerPackages.length > 0) {
  run(["ci", "--omit=dev"], serverRoot);
}

run(["run", "build"], serverRoot);
