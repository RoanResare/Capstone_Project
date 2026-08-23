import { fileURLToPath, URL } from "node:url";
import { defineConfig, loadEnv } from "vite";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";

const GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions";
const DEFAULT_MODELS = ["llama3-8b-8192", "llama-3.3-70b-versatile", "llama3-70b-8192"];

function normalizeModuleId(id = "") {
  return String(id).replace(/\\/g, "/");
}

function resolveManualChunk(id = "") {
  const normalizedId = normalizeModuleId(id);

  if (!normalizedId.includes("/node_modules/")) {
    return undefined;
  }

  if (
    normalizedId.includes("/node_modules/firebase/") ||
    normalizedId.includes("/node_modules/@firebase/")
  ) {
    if (normalizedId.includes("/firestore")) {
      return "firebase-firestore";
    }

    if (normalizedId.includes("/auth")) {
      return "firebase-auth";
    }

    if (normalizedId.includes("/analytics")) {
      return "firebase-analytics";
    }

    return "firebase-core";
  }

  if (
    normalizedId.includes("/node_modules/react-router/") ||
    normalizedId.includes("/node_modules/react-router-dom/") ||
    normalizedId.includes("/node_modules/@remix-run/router/")
  ) {
    return "router";
  }

  if (
    normalizedId.includes("/node_modules/motion/") ||
    normalizedId.includes("/node_modules/framer-motion/") ||
    normalizedId.includes("/node_modules/motion-dom/") ||
    normalizedId.includes("/node_modules/motion-utils/")
  ) {
    return "motion";
  }

  if (normalizedId.includes("/node_modules/lucide-react/")) {
    return "icons";
  }

  return undefined;
}

function normalizeValue(value = "") {
  return String(value || "").trim();
}

function getEnvValue(env, ...names) {
  for (const name of names) {
    const value = normalizeValue(env?.[name] || process.env?.[name]);
    if (value) {
      return value;
    }
  }

  return "";
}

function getServerGroqApiKey(env) {
  return getEnvValue(env, "GROQ_API_KEY", "VITE_GROQ_API_KEY");
}

function getServerGroqModelCandidates(env) {
  const configuredModel = getEnvValue(env, "GROQ_MODEL", "VITE_GROQ_MODEL");
  return [configuredModel, ...DEFAULT_MODELS].filter(
    (model, index, values) => Boolean(model) && values.indexOf(model) === index,
  );
}

function describeGroqStatus(env) {
  const apiKey = getServerGroqApiKey(env);
  const proxyUrl = getEnvValue(env, "VITE_GROQ_PROXY_URL");

  if (proxyUrl) {
    return {
      ready: true,
      mode: "custom-proxy",
      message: "Using the configured external Groq proxy.",
      hasServerKey: false,
      hasCustomProxy: true,
      model: getEnvValue(env, "GROQ_MODEL", "VITE_GROQ_MODEL") || DEFAULT_MODELS[0],
    };
  }

  if (apiKey) {
    return {
      ready: true,
      mode: "local-proxy",
      message: "The local Groq proxy is ready.",
      hasServerKey: true,
      hasCustomProxy: false,
      model: getServerGroqModelCandidates(env)[0] || DEFAULT_MODELS[0],
    };
  }

  return {
    ready: false,
    mode: "missing-config",
    message:
      "The running Vite server started without a Groq API key. Add GROQ_API_KEY to .env or configure VITE_GROQ_PROXY_URL, then restart npm run dev.",
    hasServerKey: false,
    hasCustomProxy: false,
    model: "",
  };
}

function jsonResponse(res, statusCode, payload) {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(payload));
}

async function readJsonBody(req) {
  const chunks = [];

  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  const rawBody = Buffer.concat(chunks).toString("utf8").trim();
  if (!rawBody) {
    return {};
  }

  return JSON.parse(rawBody);
}

async function parseJsonSafely(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function createGroqProxyPlugin(env) {
  async function handleGroqStatus(req, res) {
    jsonResponse(res, 200, describeGroqStatus(env));
  }

  async function handleGroqChat(req, res) {
    if (req.method !== "POST") {
      jsonResponse(res, 405, { error: "Method not allowed." });
      return;
    }

    const customProxyUrl = getEnvValue(env, "VITE_GROQ_PROXY_URL");
    if (customProxyUrl) {
      jsonResponse(res, 400, {
        error:
          "VITE_GROQ_PROXY_URL is configured, so the browser should call that external proxy directly.",
      });
      return;
    }

    const apiKey = getServerGroqApiKey(env);
    if (!apiKey) {
      jsonResponse(res, 503, {
        error:
          "The running Vite server does not have a Groq API key yet. Add GROQ_API_KEY to .env or configure VITE_GROQ_PROXY_URL, then restart npm run dev.",
      });
      return;
    }

    let payload = {};

    try {
      payload = await readJsonBody(req);
    } catch {
      jsonResponse(res, 400, { error: "Invalid JSON request body." });
      return;
    }

    const history = Array.isArray(payload.history) ? payload.history : [];
    const messages = history
      .filter((entry) => entry?.role && entry?.content)
      .map((entry) => ({
        role: entry.role === "assistant" ? "assistant" : "user",
        content: String(entry.content).trim(),
      }))
      .filter((entry) => entry.content);

    if (payload.systemPrompt) {
      messages.unshift({
        role: "system",
        content: String(payload.systemPrompt).trim(),
      });
    }

    if (payload.message) {
      messages.push({
        role: "user",
        content: String(payload.message).trim(),
      });
    }

    if (!messages.length) {
      jsonResponse(res, 400, { error: "A chatbot message is required." });
      return;
    }

    let lastError = null;

    for (const model of getServerGroqModelCandidates(env)) {
      try {
        const response = await fetch(GROQ_API_URL, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            model,
            temperature: 0.2,
            max_tokens: 140,
            messages,
          }),
          signal: AbortSignal.timeout(9000),
        });
        const data = await parseJsonSafely(response);

        if (!response.ok) {
          lastError =
            data?.error?.message || `Groq request failed with status ${response.status}.`;
          continue;
        }

        const answer = String(data?.choices?.[0]?.message?.content || "")
          .replace(/\n{3,}/g, "\n\n")
          .trim();

        if (!answer) {
          lastError = "Groq returned an empty response.";
          continue;
        }

        jsonResponse(res, 200, {
          answer,
          model,
          provider: "groq-proxy",
        });
        return;
      } catch (error) {
        lastError = error instanceof Error ? error.message : "Groq request failed.";
      }
    }

    jsonResponse(res, 502, {
      error: lastError || "Unable to get a response from Groq.",
    });
  }

  function registerGroqRoutes(server) {
    server.middlewares.use((req, res, next) => {
      const pathname = req.url ? req.url.split("?")[0] : "";

      if (pathname === "/api/groq-status") {
        handleGroqStatus(req, res);
        return;
      }

      if (pathname === "/api/groq-chat") {
        handleGroqChat(req, res);
        return;
      }

      next();
    });
  }

  return {
    name: "local-groq-proxy",
    configureServer(server) {
      registerGroqRoutes(server);
    },
    configurePreviewServer(server) {
      registerGroqRoutes(server);
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const requestedDevPort = Number(getEnvValue(env, "PORT", "VITE_PORT"));
  const requestedPreviewPort = Number(getEnvValue(env, "PREVIEW_PORT", "VITE_PREVIEW_PORT"));
  const devPort = Number.isInteger(requestedDevPort) && requestedDevPort > 0 ? requestedDevPort : 5173;
  const previewPort =
    Number.isInteger(requestedPreviewPort) && requestedPreviewPort > 0 ? requestedPreviewPort : 4173;

  return {
    plugins: [react(), tailwindcss(), createGroqProxyPlugin(env)],
    server: {
      host: true,
      port: devPort,
      strictPort: false,
    },
    preview: {
      host: true,
      port: previewPort,
      strictPort: false,
    },
    build: {
      rolldownOptions: {
        output: {
          manualChunks(id) {
            return resolveManualChunk(id);
          },
        },
      },
    },
    resolve: {
      alias: {
        "@": fileURLToPath(new URL("./src", import.meta.url)),
      },
    },
    assetsInclude: ["**/*.svg", "**/*.csv"],
  };
});
