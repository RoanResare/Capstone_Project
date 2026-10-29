import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const serverRoot = resolve(projectRoot, "server");
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

run(["run", "build:frontend"], projectRoot);

// Root-directory Render services install root dependencies only. Install the
// API package dependencies too so `npm start` can run the Express application.
const requiredServerPackages = ["express-rate-limit", "helmet", "pg", "resend"];
if (requiredServerPackages.some(name => !existsSync(resolve(serverRoot, "node_modules", name, "package.json")))) {
  run(["ci", "--omit=dev"], serverRoot);
}

if (!existsSync(resolve(serverRoot, "dist", "index.html"))) {
  throw new Error("Render build completed without server/dist/index.html.");
}
