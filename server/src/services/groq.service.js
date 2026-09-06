const Groq = require("groq-sdk");

const DEFAULT_GROQ_MODEL = "llama-3.3-70b-versatile";
const FALLBACK_GROQ_MODELS = [DEFAULT_GROQ_MODEL, "llama-3.1-8b-instant"];
const GROQ_TIMEOUT_MS = 12000;
const MAX_HISTORY_MESSAGES = 2;

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

function normalizeValue(value = "") {
  return String(value || "").trim();
}

function getGroqApiKey() {
  return normalizeValue(process.env.GROQ_API_KEY);
}

function getConfiguredModel() {
  return normalizeValue(process.env.GROQ_MODEL);
}

function getModelCandidates(payload = {}) {
  const requestedModels = [
    normalizeValue(payload.model),
    ...(Array.isArray(payload.models) ? payload.models.map((model) => normalizeValue(model)) : []),
  ].filter((model) => FALLBACK_GROQ_MODELS.includes(model));
  const configuredModel = getConfiguredModel();
  const configuredFallback =
    configuredModel && FALLBACK_GROQ_MODELS.includes(configuredModel) ? configuredModel : "";

  return [configuredFallback, ...requestedModels, ...FALLBACK_GROQ_MODELS].filter(
    (model, index, values) => Boolean(model) && values.indexOf(model) === index,
  );
}

function buildMessages(payload = {}) {
  const history = Array.isArray(payload.history) ? payload.history : [];
  const messages = history
    .filter((entry) => entry?.role && entry?.content)
    .map((entry) => ({
      role: entry.role === "assistant" ? "assistant" : "user",
      content: normalizeValue(entry.content),
    }))
    .filter((entry) => entry.content)
    .slice(-MAX_HISTORY_MESSAGES);
  const message = normalizeValue(payload.message);

  if (message) {
    messages.push({
      role: "user",
      content: message,
    });
  }

  return [
    {
      role: "system",
      content: GROQ_SYSTEM_PROMPT,
    },
    ...messages,
  ];
}

function createGroqClient() {
  const apiKey = getGroqApiKey();

  if (!apiKey) {
    return null;
  }

  return new Groq({ apiKey });
}

function getGroqStatus() {
  const apiKey = getGroqApiKey();

  return {
    ready: Boolean(apiKey),
    mode: apiKey ? "express-proxy" : "missing-config",
    message: apiKey
      ? "The Express Groq proxy is ready."
      : "The backend is missing GROQ_API_KEY.",
    hasServerKey: Boolean(apiKey),
    hasCustomProxy: false,
    model: getModelCandidates()[0] || DEFAULT_GROQ_MODEL,
  };
}

function createFallbackChunk(content) {
  return {
    choices: [
      {
        delta: {
          content,
        },
      },
    ],
  };
}

async function createChatCompletion(payload = {}) {
  const groq = createGroqClient();

  if (!groq) {
    const error = new Error("GROQ_API_KEY is not configured on the backend.");
    error.statusCode = 503;
    throw error;
  }

  const messages = buildMessages(payload);
  if (messages.length <= 1) {
    const error = new Error("A chatbot message is required.");
    error.statusCode = 400;
    throw error;
  }

  let lastError = null;

  for (const model of getModelCandidates(payload)) {
    try {
      const completion = await groq.chat.completions.create(
        {
          model,
          temperature: 0.2,
          max_tokens: 250,
          stream: false,
          messages,
        },
        {
          signal: AbortSignal.timeout(GROQ_TIMEOUT_MS),
        },
      );
      const answer = normalizeValue(completion?.choices?.[0]?.message?.content).replace(
        /\n{3,}/g,
        "\n\n",
      );

      if (!answer) {
        lastError = new Error("Groq returned an empty response.");
        continue;
      }

      return {
        answer,
        model,
        provider: "groq",
      };
    } catch (error) {
      lastError = error;
      console.error("[groq] Chat completion failed.", {
        model,
        error: error instanceof Error ? error.message : String(error || "Unknown error"),
        status: error?.status || error?.response?.status || null,
        code: error?.code || null,
      });
    }
  }

  const error = new Error(
    lastError instanceof Error ? lastError.message : "Unable to get a response from Groq.",
  );
  error.statusCode = lastError?.status || lastError?.response?.status || 502;
  throw error;
}

async function createChatCompletionStream(payload = {}, onChunk) {
  const groq = createGroqClient();

  if (!groq) {
    const error = new Error("GROQ_API_KEY is not configured on the backend.");
    error.statusCode = 503;
    throw error;
  }

  const messages = buildMessages(payload);
  if (messages.length <= 1) {
    const error = new Error("A chatbot message is required.");
    error.statusCode = 400;
    throw error;
  }

  let lastError = null;

  for (const model of getModelCandidates(payload)) {
    let answer = "";

    try {
      const completion = await groq.chat.completions.create(
        {
          model,
          temperature: 0.2,
          max_tokens: 250,
          stream: true,
          messages,
        },
        {
          signal: AbortSignal.timeout(GROQ_TIMEOUT_MS),
        },
      );

      for await (const chunk of completion) {
        const token = chunk?.choices?.[0]?.delta?.content || "";
        if (token) {
          answer += token;
        }
        onChunk(chunk);
      }

      if (normalizeValue(answer)) {
        return {
          answer: normalizeValue(answer).replace(/\n{3,}/g, "\n\n"),
          model,
          provider: "groq",
        };
      }

      lastError = new Error("Groq returned an empty response.");
    } catch (error) {
      lastError = error;
      console.error("[groq] Streaming chat completion failed.", {
        model,
        error: error instanceof Error ? error.message : String(error || "Unknown error"),
        status: error?.status || error?.response?.status || null,
        code: error?.code || null,
      });
    }
  }

  const error = new Error(
    lastError instanceof Error ? lastError.message : "Unable to get a response from Groq.",
  );
  error.statusCode = lastError?.status || lastError?.response?.status || 502;
  throw error;
}

module.exports = {
  createChatCompletion,
  createChatCompletionStream,
  createFallbackChunk,
  getGroqStatus,
};
