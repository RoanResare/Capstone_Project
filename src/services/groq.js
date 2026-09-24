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
export const GROQ_MODEL = "llama3-8b-8192";
export const GROQ_MODELS = [GROQ_MODEL, "llama-3.3-70b-versatile"];
const MAX_HISTORY_MESSAGES = 2;
const GROQ_REQUEST_TIMEOUT_MS = 12000;
const INAPPROPRIATE_PATTERN =
  /\b(fuck|shit|bitch|asshole|bastard|tangina|putangina|puta|gago|gaga|ulol|tarantado|hayop|pakyu|kantot|sex|porn)\b/i;

export const BLOCKED_CUSTOMER_MESSAGE =
  "I'm sorry, but I can only assist with polite questions regarding our pet care services, clinic hours, and appointments.";

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
- If the user inputs inappropriate words, reply strictly with: "${BLOCKED_CUSTOMER_MESSAGE}"

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
    return "Live chat took too long to answer. Please try again.";
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
        model: GROQ_MODEL,
        models: GROQ_MODELS,
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

    const answer = trimResponse(
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
          onToken?.(token);
        }
      }
    }
  }

  return {
    answer: trimResponse(answer),
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
        model: GROQ_MODEL,
        models: GROQ_MODELS,
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
