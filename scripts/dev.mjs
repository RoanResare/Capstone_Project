import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");

const children = [];
let shuttingDown = false;

function pipeOutput(stream, prefix, target) {
  stream.on("data", (chunk) => {
    const text = chunk.toString();
    const lines = text.split(/\r?\n/);

    lines.forEach((line, index) => {
      if (!line && index === lines.length - 1) {
        return;
      }

      target.write(line ? `[${prefix}] ${line}\n` : "\n");
    });
  });
}

function startProcess(name, command, args, cwd = projectRoot) {
  const child = spawn(command, args, {
    cwd,
    env: process.env,
    // Keep the child processes alive even if the terminal input stream changes.
    // This avoids Vite/Node watch sessions dropping when VS Code interrupts stdin.
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: false,
  });

  pipeOutput(child.stdout, name, process.stdout);
  pipeOutput(child.stderr, name, process.stderr);

  child.on("exit", (code, signal) => {
    if (shuttingDown) {
      return;
    }

    if (typeof code === "number" && code !== 0) {
      process.exitCode = code;
    } else if (signal) {
      process.exitCode = 1;
    }

    shutdown(`${name}:${signal || `exit:${code ?? 0}`}`);
  });

  children.push(child);
  return child;
}

function shutdown(reason = "shutdown") {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;
  process.stdout.write(`[dev] stopping processes (${reason})\n`);

  children.forEach((child) => {
    if (!child.killed) {
      child.kill("SIGINT");
    }
  });
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

startProcess("server", process.execPath, ["scripts/dev-server.mjs"]);
startProcess("client", process.execPath, ["node_modules/vite/bin/vite.js"]);
