import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnv } from "vite";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const fileEnv = loadEnv("production", projectRoot, "VITE_");
const getValue = (name) => String(process.env[name] || fileEnv[name] || "").trim();
const missing = ["VITE_SUPABASE_URL", "VITE_SUPABASE_ANON_KEY"].filter((name) => !getValue(name));

if (missing.length) {
  throw new Error(
    `[build] Missing required frontend build environment variable(s): ${missing.join(", ")}. ` +
    "Add them to the Render service that builds the frontend, then deploy again.",
  );
}

try {
  const url = new URL(getValue("VITE_SUPABASE_URL"));
  if (!url.hostname || !["https:", "http:"].includes(url.protocol)) throw new Error("invalid URL");
} catch {
  throw new Error("[build] VITE_SUPABASE_URL must be a valid absolute HTTP(S) URL.");
}

console.info("[build] Supabase browser configuration is present (values hidden). ");
