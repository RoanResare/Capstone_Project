import { cpSync, existsSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const frontendDist = resolve(projectRoot, "dist");
const serverDist = resolve(projectRoot, "server", "dist");
const frontendIndex = resolve(frontendDist, "index.html");

if (!existsSync(frontendIndex)) {
  throw new Error(`Vite output is missing ${frontendIndex}; run the frontend build before copying it.`);
}
if (serverDist !== resolve(projectRoot, "server", "dist")) {
  throw new Error("Refusing to replace an unexpected frontend output directory.");
}

rmSync(serverDist, { recursive: true, force: true });
cpSync(frontendDist, serverDist, { recursive: true });
if (!existsSync(resolve(serverDist, "index.html"))) {
  throw new Error(`The server bundle was not created at ${resolve(serverDist, "index.html")}.`);
}
console.info(`[build] Frontend bundle copied to ${serverDist}`);
