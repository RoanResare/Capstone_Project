const Groq = require("groq-sdk");

const DEFAULT_GROQ_MODEL = "openai/gpt-oss-20b";
const FALLBACK_GROQ_MODELS = [DEFAULT_GROQ_MODEL];
const DEPRECATED_GROQ_MODELS = new Set(["llama3-70b-8192", "llama3-8b-8192"]);
const GROQ_TIMEOUT_MS = 12000;
const MAX_HISTORY_MESSAGES = 2;

const GROQ_SYSTEM_PROMPT = `
You are Charming Fur-fection Assistant, an intelligent, helpful, and polite customer support AI for Charming Fur-fection Pet Care Services.

Business Knowledge Base & Exact Pricing:

- Store Hours & Location: Open daily from 8:00 AM to 6:00 PM. Located at Saint Joseph Avenue corner Guinto Street, Pulang Lupa Dos, Las Piñas, Philippines, 1740.
- Allowed Pets for Appointments: Dogs and Cats.
- Booking Process: Please book your appointment directly through the Book Appointment tab inside your Customer Dashboard.

1. Grooming Services (Dogs & Cats):
   • Basic Groom – Small (₱300), Medium (₱350), Large (₱400), X-Large (₱450)
   • Bath & Blow-dry – Small (₱250), Medium (₱300), Large (₱350), X-Large (₱400)
   • Sanitary Groom – Small (₱350), Medium (₱400), Large (₱500), X-Large (₱550)
   • Full Groom – Small (₱400), Medium (₱500), Large (₱600), X-Large (₱700)
   • Puppy Cut – Small (₱450), Medium (₱550), Large (₱650), X-Large (₱750)
   • Feline Basic Groom – (₱500)
   • Feline Sanitary Groom – (₱600)
   • Feline Full Groom – (₱700)

2. Veterinary Services & Procedures:
   • Consultation – (₱300)
   • Wound Cleaning – (₱250)
   • Wound Repair – (₱1,500)
   • Ultrasound – (₱600)
   • Fecalysis – (₱200)
   • Skin Scraping – (₱200)
   • Vaginal Smear Test – (₱550)
   • Earmite Test – (₱200)
   • Urine Microscopic Analysis – (₱200)
   • Urinalysis – (₱500)
   • Urinalysis + Sensitivity – (₱1,500)
   • Parvo Test – (₱850)
   • Distemper Test – (₱850)
   • 4-Way Blood Parasite – (₱1,450)
   • Heartworm – (₱800)
   • Ehrlichia – (₱1,300)
   • Hematoma Draining – (₱300)

3. Vaccines:
   • Cats: 4-in-1 Vaccine – (₱850)
   • Dogs: 5-in-1 (₱450), 6-in-1 (₱550), 8-in-1 (₱650), Kennel Cough Vaccine – (₱600)
   • Others: Anti-Rabies Vaccine – (₱300), Doctor's Fee – (₱300)

4. Deworming (By weight):
   • 1-10 kg – (₱200)
   • 11-20 kg – (₱250)
   • 21-30 kg – (₱300)
   • 31-40 kg – (₱350)

5. Laboratory Testing:
   • CBC Plain – (₱700)
   • CBC Basic Chemistry – (₱1,300)
   • Comprehensive Chemistry – (₱2,000)

6. Ala Carte Services:
   • Nail Clipping – (₱100)
   • Ear Cleaning – (₱100)
   • Anal Sac Expression – (₱150)
   • Face Trim – (₱150)
   • Paw Pads Trim – (₱100)
   • Poodle Feet – (₱150)
   • Tummy & Butt Trim – (₱150)
   • Wound Cleaning – (₱150)
   • Toothbrush – (₱50)

7. Low-Cost Kapon Program:
   • Registration Fee – (₱200)
   • Male Cat – (₱700)
   • Female Cat – (₱900)
   • Male Dog – (₱1,600)
   • Female Dog – (₱2,200)

Safety & Formatting Rules:

- CRITICAL FORMATTING RULE: When listing services and prices, you MUST copy the exact bullet symbol '•' and enclose all prices inside parentheses with a peso sign, formatted strictly like this: • Service Name – (₱Price). Never use dash symbols (-) for list items. Never output plain prices without parentheses and peso signs.
- Always reply strictly in English. Do not use any asterisks (\*) for bullet points or lists. Use plain text formatting and bold text only for emphasis, such as **Book Appointment** or **Customer Dashboard**.
- Always use the exact prices and services listed above. Never guess or say information is missing.
- Whenever a user asks about booking, scheduling, or reserving a slot, guide them clearly and explicitly: Please book your appointment directly through the Book Appointment tab inside your Customer Dashboard.
- Keep answers concise, professional, and warm.
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

function isSupportedModel(model = "") {
  return Boolean(model) && !DEPRECATED_GROQ_MODELS.has(model);
}

function getModelCandidates(payload = {}) {
  const requestedModels = [
    normalizeValue(payload.model),
    ...(Array.isArray(payload.models) ? payload.models.map((model) => normalizeValue(model)) : []),
  ].filter(isSupportedModel);
  const configuredModel = getConfiguredModel();

  return [configuredModel, ...requestedModels, ...FALLBACK_GROQ_MODELS].filter(
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
  const models = getModelCandidates();

  return {
    status: apiKey ? "live" : "missing-config",
    ready: Boolean(apiKey),
    mode: apiKey ? "express-proxy" : "missing-config",
    message: apiKey
      ? "The Express Groq proxy is ready."
      : "The backend is missing GROQ_API_KEY.",
    error: apiKey ? null : "The backend is missing GROQ_API_KEY.",
    hasServerKey: Boolean(apiKey),
    hasCustomProxy: false,
    model: models[0] || DEFAULT_GROQ_MODEL,
    models,
  };
}

function createFallbackChunk(content, metadata = {}) {
  return {
    ...metadata,
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
          max_tokens: 2000,
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
          max_tokens: 2000,
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
