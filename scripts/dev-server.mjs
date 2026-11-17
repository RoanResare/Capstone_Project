import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");
const serverRoot = path.join(projectRoot, "server");
const nodemonEntrypoint = path.join(serverRoot, "node_modules", "nodemon", "bin", "nodemon.js");

const child = spawn(
  process.execPath,
  [nodemonEntrypoint, "--config", "nodemon.json", "--quiet", "server.js"],
  {
    cwd: serverRoot,
    env: process.env,
    stdio: "inherit",
    windowsHide: false,
  },
);

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }

  process.exit(code ?? 0);
});
