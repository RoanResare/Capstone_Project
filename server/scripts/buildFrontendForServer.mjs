import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const serverRoot = resolve(import.meta.dirname, "..");
const projectRoot = resolve(serverRoot, "..");
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

const calendarPackages = ["react", "daygrid", "timegrid", "interaction"];
if (!existsSync(join(projectRoot, "node_modules", ".bin", "vite")) ||
    calendarPackages.some(name => !existsSync(join(projectRoot, "node_modules", "@fullcalendar", name, "package.json")))) {
  run(["install", "--no-audit", "--no-fund"], projectRoot);
}

run(["run", "build"], projectRoot);

const serverIndex = join(serverRoot, "dist", "index.html");
if (!existsSync(serverIndex)) throw new Error(`Frontend build did not produce ${serverIndex}.`);
