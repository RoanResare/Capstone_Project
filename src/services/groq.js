import { chatbotSuggestionChips } from "../app/data/systemData.js";

function getDefaultApiBaseUrl() {
  if (typeof window !== "undefined" && ["localhost", "127.0.0.1"].includes(window.location.hostname)) {
    return "http://localhost:5000/api";
  }

  return "https://capstone-project-bczf.onrender.com/api";
}

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || getDefaultApiBaseUrl()).replace(
  /\/+$/,
  "",
);
const DEFAULT_PROXY_URL = `${API_BASE_URL}/groq-chat`;
const DEFAULT_STATUS_URL = `${API_BASE_URL}/groq-status`;
const DEFAULT_GROQ_MODEL = "openai/gpt-oss-20b";
const DEPRECATED_GROQ_MODELS = new Set(["llama3-70b-8192", "llama3-8b-8192"]);
export const GROQ_MODEL = normalizeValue(import.meta.env.VITE_GROQ_MODEL) || DEFAULT_GROQ_MODEL;
export const GROQ_MODELS = [GROQ_MODEL];
const MAX_HISTORY_MESSAGES = 2;
const GROQ_REQUEST_TIMEOUT_MS = 12000;
const INAPPROPRIATE_PATTERN =
  /\b(fuck|shit|bitch|asshole|bastard|tangina|putangina|puta|gago|gaga|ulol|tarantado|hayop|pakyu|kantot|sex|porn)\b/i;

export const BLOCKED_CUSTOMER_MESSAGE =
  "I'm sorry, but I can only assist with polite questions regarding our pet care services, clinic hours, and appointments.";
export const CHAT_TIMEOUT_ERROR_MESSAGE =
  "The request took too long or connection timed out. Please try sending your message again.";

const GROQ_SYSTEM_PROMPT = `
You are the official AI Assistant for Charming Fur-fection Assistant, a professional pet care clinic. Your primary goal is to provide helpful, accurate, and direct answers in English to users regarding our services, exact prices, store hours, and clinic information.

Clinic Hours & Location:

- Open daily from 8:00 AM to 6:00 PM.
- Located in Las Pinas City.

1. Grooming Rates (Dogs & Cats):

- Basic Groom (Small: 300, Medium: 350, Large: 400, X-Large: 450)
- Bath & Blowdry (Small: 250, Medium: 300, Large: 350, X-Large: 400)
- Sanitary Groom (Small: 350, Medium: 400, Large: 500, X-Large: 550)
- Full Groom (Small: 400, Medium: 500, Large: 600, X-Large: 700)
- Puppy Cut (Small: 450, Medium: 550, Large: 650, X-Large: 750)
- Feline Basic Groom: 500
- Feline Sanitary Groom: 600
- Feline Full Groom: 700

2. Veterinary Services & Procedures:

- Consultation: 300
- Wound Cleaning: 250
- Wound Repair: 1,500
- Ultrasound: 600
- Fecalysis: 200
- Skin Scraping: 200
- Vaginal Smear Test: 550
- Earmite Test: 200
- Urine Microscopic Analysis: 200
- Urinalysis: 500
- Urinalysis + Sensitivity: 1,500
- Parvo Test: 850
- Distemper Test: 850
- 4-Way Blood Parasite: 1,450
- Heartworm: 800
- Ehrlichia: 1,300
- Hematoma Draining: 300

3. Vaccines:

- Cats: 4 in 1 Vaccine - 850
- Dogs: 5 in 1 - 450, 6 in 1 - 550, 8 in 1 - 650, Kennel Cough Vaccine - 600
- Others: Anti Rabies Vaccine - 300, Doctor's Fee - 300

4. Deworming (By weight):

- 1-10 kgs: 200
- 11-20 kgs: 250
- 21-30 kgs: 300
- 31-40 kgs: 350

5. Laboratory Testing:

- CBC Plain: 700
- CBC Basic Chemistry: 1,300
- Comprehensive Chem: 2,000

6. Ala Carte Services:

- Nail Clipping: 100
- Ear Cleaning: 100
- Anal Sac Expression: 150
- Face Trim: 150
- Paw Pads Trim: 100
- Poodle Feet: 150
- Tummy & Butt Trim: 150
- Wound Cleaning: 150
- Toothbrush: 50

7. Low-Cost Kapon Program:

- Registration Fee: 200
- Male Cat: 700
- Female Cat: 900
- Male Dog: 1,600
- Female Dog: 2,200

Core Guidelines:

1. Language & Formatting: Always reply strictly in English. Do not use any asterisks (*) for bullet points or lists. Use plain text formatting and bold text only for emphasis, such as **Book Appointment**.
2. Accurate Details: Always use the exact prices and services listed above. Never guess or say information is missing.
3. Direct Booking: Whenever a user asks about booking, scheduling, or reserving a slot, use this exact phrase and nothing else: Please book your appointment directly through the Book Appointment tab inside your Customer Dashboard.
4. Tone: Be warm, professional, and concise.
`.trim();

function normalizeValue(value = "") {
  return String(value || "").trim();
}

function isSupportedModel(model = "") {
  return Boolean(model) && !DEPRECATED_GROQ_MODELS.has(model);
}

function getConfiguredProxyUrl() {
  return normalizeValue(import.meta.env.VITE_GROQ_PROXY_URL);
}

function getProxyUrl() {
  return getConfiguredProxyUrl() || DEFAULT_PROXY_URL;
}

function getGroqStatusUrl() {
  return getConfiguredProxyUrl() ? "" : DEFAULT_STATUS_URL;
}

function buildRecentHistory(history = []) {
  return history
    .filter((entry) => entry?.role && entry?.content)
    .map((entry) => ({
      role: entry.role === "assistant" ? "assistant" : "user",
      content: normalizeValue(entry.content),
    }))
    .filter((entry) => entry.content)
    .slice(-MAX_HISTORY_MESSAGES);
}

async function parseJsonSafely(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function buildErrorMessage(error) {
  const message = error instanceof Error ? error.message : String(error || "");
  const lookup = message.toLowerCase();

  if (lookup.includes("api key") || lookup.includes("unauthorized") || lookup.includes("401")) {
    return "Live chat is not configured correctly yet. Please try again shortly.";
  }

  if (lookup.includes("rate limit") || lookup.includes("429")) {
    return "Live chat is busy right now. Please try again in a moment.";
  }

  if (lookup.includes("timed out") || lookup.includes("abort")) {
    return CHAT_TIMEOUT_ERROR_MESSAGE;
  }

  return "Sorry, I could not connect to live chat right now. Please try again in a moment.";
}

function detectLanguage(message) {
  return /\b(ano|oras|paano|kailan|kelan|magkano|serbisyo|pwede|puwede|po|opo|kayo|nyo|niyo|appointment ba)\b/i.test(
    normalizeValue(message),
  )
    ? "tl"
    : "en";
}

function trimResponse(value = "") {
  return normalizeValue(value).replace(/\n{3,}/g, "\n\n");
}

function sanitizeAssistantReply(value = "") {
  return trimResponse(value).replace(/\*/g, "");
}

function containsInappropriateLanguage(message = "") {
  return INAPPROPRIATE_PATTERN.test(normalizeValue(message));
}

async function callGroqProxy(message, history) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), GROQ_REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(getProxyUrl(), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: isSupportedModel(GROQ_MODEL) ? GROQ_MODEL : DEFAULT_GROQ_MODEL,
        models: GROQ_MODELS.filter(isSupportedModel),
        message,
        history: buildRecentHistory(history),
        systemPrompt: GROQ_SYSTEM_PROMPT,
        stream: false,
      }),
      signal: controller.signal,
    });
    const data = await parseJsonSafely(response);

    if (!response.ok) {
      throw new Error(data?.error || `Proxy request failed with status ${response.status}.`);
    }

    const answer = sanitizeAssistantReply(
      data?.reply || data?.answer || data?.choices?.[0]?.message?.content || "",
    );

    if (!answer) {
      throw new Error("Proxy returned an empty response.");
    }

    return {
      answer,
      model: data?.model || "proxy",
      provider: data?.provider || "groq",
      warning: data?.warning || "",
    };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("Groq request timed out.");
    }

    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

async function parseGroqStream(response, onToken) {
  if (!response.body) {
    throw new Error("Proxy returned an empty response.");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let answer = "";
  let model = "";
  let provider = "groq";
  let warning = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) {
      break;
    }

    buffer += decoder.decode(value, { stream: true });
    const events = buffer.split("\n\n");
    buffer = events.pop() || "";

    for (const event of events) {
      const dataLines = event
        .split("\n")
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.replace(/^data:\s*/, "").trim());

      for (const dataLine of dataLines) {
        if (!dataLine || dataLine === "[DONE]") {
          continue;
        }

        let data = null;
        try {
          data = JSON.parse(dataLine);
        } catch {
          continue;
        }

        if (typeof data?.model === "string" && data.model) {
          model = data.model;
        }

        if (typeof data?.provider === "string" && data.provider) {
          provider = data.provider;
        }

        if (typeof data?.warning === "string" && data.warning) {
          warning = data.warning;
        }

        const token = data?.choices?.[0]?.delta?.content || "";
        if (token) {
          answer += token;
        }
      }
    }
  }

  const sanitizedAnswer = sanitizeAssistantReply(answer);
  if (sanitizedAnswer) {
    onToken?.(sanitizedAnswer);
  }

  return {
    answer: sanitizedAnswer,
    model,
    provider,
    warning,
  };
}

async function callGroqProxyStream(message, history, onToken) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), GROQ_REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(getProxyUrl(), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: isSupportedModel(GROQ_MODEL) ? GROQ_MODEL : DEFAULT_GROQ_MODEL,
        models: GROQ_MODELS.filter(isSupportedModel),
        message,
        history: buildRecentHistory(history),
        systemPrompt: GROQ_SYSTEM_PROMPT,
        stream: true,
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const data = await parseJsonSafely(response);
      throw new Error(data?.error || `Proxy request failed with status ${response.status}.`);
    }

    const result = await parseGroqStream(response, onToken);
    const answer = result.answer;
    if (!answer) {
      throw new Error("Proxy returned an empty response.");
    }

    return {
      answer,
      model: result.model || GROQ_MODEL,
      provider: result.provider || "groq",
      warning: result.warning || "",
    };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("Groq request timed out.");
    }

    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function getGroqRuntimeStatus() {
  const customProxyUrl = getConfiguredProxyUrl();
  if (customProxyUrl) {
    return {
      ready: true,
      mode: "custom-proxy",
      summary: "Live Groq replies are active.",
      helpText: "",
    };
  }

  const statusUrl = getGroqStatusUrl();
  if (!statusUrl) {
    return {
      ready: false,
      mode: "missing-config",
      summary: "Live Groq status could not be checked.",
      helpText: "Configure a local Groq key or a custom proxy URL to enable live replies.",
    };
  }

  try {
    const response = await fetch(statusUrl);
    const data = await parseJsonSafely(response);

    if (!response.ok && !data) {
      throw new Error(data?.error || `Status request failed with status ${response.status}.`);
    }

    const ready = Boolean(data?.ready || data?.status === "live");

    return {
      ready,
      mode: data?.mode || "unknown",
      model: data?.model || GROQ_MODEL,
      models: Array.isArray(data?.models) && data.models.length ? data.models : GROQ_MODELS,
      summary: ready
        ? data?.message || "Live Groq replies are active."
        : "Live Groq replies are not configured.",
      helpText: ready
        ? ""
        : data?.message ||
          "The running server does not have a Groq API key yet. Add GROQ_API_KEY, then restart npm run dev.",
    };
  } catch {
    return {
      ready: false,
      mode: "status-unavailable",
      summary: "Live Groq status could not be checked.",
      helpText:
        "Live Groq status could not be checked. Restart npm run dev after changing Groq settings.",
    };
  }
}

export async function askGroqAssistant({ message, history = [] }) {
  const cleanMessage = normalizeValue(message);
  if (!cleanMessage) {
    throw new Error("Message is required.");
  }

  if (containsInappropriateLanguage(cleanMessage)) {
    return {
      answer: BLOCKED_CUSTOMER_MESSAGE,
      recognized: false,
      language: detectLanguage(cleanMessage),
      topic: "safety",
      provider: "guardrail",
      model: "",
      warning: "Message blocked by local safety guardrail.",
    };
  }

  try {
    const result = await callGroqProxy(cleanMessage, history);
    return {
      answer: result.answer,
      recognized: true,
      language: detectLanguage(cleanMessage),
      topic: "dynamic",
      provider: result.provider || "groq",
      model: result.model || GROQ_MODEL,
      warning: result.warning || "",
    };
  } catch (error) {
    const answer = buildErrorMessage(error);
    return {
      answer,
      recognized: false,
      language: detectLanguage(cleanMessage),
      topic: "error",
      provider: "fallback",
      warning: error instanceof Error ? error.message : "Groq request failed.",
    };
  }
}

export async function askGroqAssistantStream({ message, history = [], onToken }) {
  const cleanMessage = normalizeValue(message);
  if (!cleanMessage) {
    throw new Error("Message is required.");
  }

  if (containsInappropriateLanguage(cleanMessage)) {
    onToken?.(BLOCKED_CUSTOMER_MESSAGE);
    return {
      answer: BLOCKED_CUSTOMER_MESSAGE,
      recognized: false,
      language: detectLanguage(cleanMessage),
      topic: "safety",
      provider: "guardrail",
      warning: "Message blocked by local safety guardrail.",
    };
  }

  try {
    const result = await callGroqProxyStream(cleanMessage, history, onToken);
    return {
      answer: result.answer,
      recognized: result.provider !== "fallback",
      language: detectLanguage(cleanMessage),
      topic: result.provider === "fallback" ? "error" : "dynamic",
      provider: result.provider || "groq",
      model: result.model || GROQ_MODEL,
      warning: result.warning || "",
    };
  } catch (error) {
    const answer = buildErrorMessage(error);
    onToken?.(answer);
    return {
      answer,
      recognized: false,
      language: detectLanguage(cleanMessage),
      topic: "error",
      provider: "fallback",
      warning: error instanceof Error ? error.message : "Groq request failed.",
    };
  }
}

export { chatbotSuggestionChips as groqSuggestionChips };
