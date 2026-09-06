import { fileURLToPath, URL } from "node:url";
import { defineConfig, loadEnv } from "vite";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import Groq from "groq-sdk";

const GROQ_MODEL = "llama-3.3-70b-versatile";
const GROQ_MODELS = [GROQ_MODEL, "llama-3.1-8b-instant"];
const GROQ_SYSTEM_PROMPT = `
You are Charming Fur-fection Assistant, an intelligent, helpful, and polite customer support AI for Charming Fur-fection Pet Care Services.

Business Knowledge Base:
- Store Hours: Monday to Sunday, 8:00 AM - 6:00 PM.
- Location: Charming Fur-fection Pet Clinic.
- Services: Grooming, Vaccination, Deworming, Consultation, Laboratory Testing, Low-Cost Kapon.
- Allowed Pets for Appointments: Dogs and Cats.
- Booking Process: Customers can book visits via the "Book Appointment" tab in their Customer Dashboard.

Safety & Inappropriate Words Guardrails:
- Strictly decline to respond to profane, abusive, explicit, violent, or inappropriate words/content in Tagalog, English, or Taglish.
- If the user inputs inappropriate words, reply strictly with: "I'm sorry, but I can only assist with polite questions regarding our pet care services, clinic hours, and appointments."

Conversational Rules:
- Answer legitimate user questions dynamically, naturally, and contextually.
- Seamlessly adapt to the user's language: English, Tagalog, or Taglish.
- Keep answers concise, with 2-3 sentences maximum to minimize response latency.
- Do not invent services, prices, schedules, locations, booking rules, or appointment eligibility beyond the business knowledge base.
- If details are unavailable, say so briefly and guide the customer to the Book Appointment tab or clinic staff.
`.trim();

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

function getServerGroqModelCandidates(env, payload = {}) {
  const configuredModel = getEnvValue(env, "GROQ_MODEL", "VITE_GROQ_MODEL");
  const requestedModels = [
    normalizeValue(payload.model),
    ...(Array.isArray(payload.models) ? payload.models.map((model) => normalizeValue(model)) : []),
  ].filter((model) => GROQ_MODELS.includes(model));
  const configuredFallback =
    configuredModel && GROQ_MODELS.includes(configuredModel) ? configuredModel : "";
  return [GROQ_MODEL, ...requestedModels, configuredFallback, ...GROQ_MODELS].filter(
    (model, index, values) => Boolean(model) && values.indexOf(model) === index,
  );
}

function getIgnoredGroqModel(env) {
  const configuredModel = getEnvValue(env, "GROQ_MODEL", "VITE_GROQ_MODEL");
  return configuredModel && !GROQ_MODELS.includes(configuredModel) ? configuredModel : "";
}

function describeGroqStatus(env) {
  const apiKey = getServerGroqApiKey(env);
  const proxyUrl = getEnvValue(env, "VITE_GROQ_PROXY_URL");

  if (proxyUrl) {
    return {
      status: "live",
      ready: true,
      mode: "custom-proxy",
      message: "Using the configured external Groq proxy.",
      hasServerKey: false,
      hasCustomProxy: true,
      model: getEnvValue(env, "GROQ_MODEL", "VITE_GROQ_MODEL") || GROQ_MODEL,
    };
  }

  if (apiKey) {
    return {
      status: "live",
      ready: true,
      mode: "local-proxy",
      message: "The local Groq proxy is ready.",
      hasServerKey: true,
      hasCustomProxy: false,
      model: getServerGroqModelCandidates(env)[0] || GROQ_MODEL,
    };
  }

  return {
    status: "missing-config",
    ready: false,
    mode: "missing-config",
    message:
      "The running Vite server started without a Groq API key. Add GROQ_API_KEY to .env or configure VITE_GROQ_PROXY_URL, then restart npm run dev.",
    error:
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

function sseHeaders(res) {
  res.statusCode = 200;
  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
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
    const status = describeGroqStatus(env);
    jsonResponse(res, status.ready ? 200 : 500, status);
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
      console.error("[groq-proxy] Missing GROQ_API_KEY. Local Groq proxy cannot send request.");
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

    messages.unshift({
      role: "system",
      content: GROQ_SYSTEM_PROMPT,
    });

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

    const wantsStream = payload.stream === true;
    const groq = new Groq({ apiKey });
    let lastError = null;
    const ignoredModel = getIgnoredGroqModel(env);

    if (ignoredModel) {
      console.warn("[groq-proxy] Ignoring unsupported GROQ_MODEL value.", {
        configuredModel: ignoredModel,
        fallbackModels: GROQ_MODELS,
      });
    }

    for (const model of getServerGroqModelCandidates(env)) {
      try {
        console.info("[groq-proxy] Sending chat completion request to Groq.", {
          model,
          messageCount: messages.length,
          stream: wantsStream,
        });

        const completion = await groq.chat.completions.create({
          model,
          temperature: 0.2,
          max_tokens: 250,
          stream: wantsStream,
          messages,
        }, {
          signal: AbortSignal.timeout(9000),
        });

        if (wantsStream) {
          sseHeaders(res);
          for await (const chunk of completion) {
            res.write(`data: ${JSON.stringify(chunk)}\n\n`);
          }
          res.write("data: [DONE]\n\n");
          res.end();
          return;
        }

        const answer = String(completion?.choices?.[0]?.message?.content || "")
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
        console.error("[groq-proxy] Groq chat completion request failed.", {
          model,
          error: lastError,
          name: error instanceof Error ? error.name : "UnknownError",
          status: error?.status || error?.response?.status || null,
          code: error?.code || null,
        });
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
