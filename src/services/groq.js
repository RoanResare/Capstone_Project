import { chatbotKnowledgeBase, chatbotSuggestionChips, serviceCatalog } from "../app/data/systemData.js";

const DEFAULT_PROXY_URL = "/api/groq-chat";
const DEFAULT_STATUS_URL = "/api/groq-status";
const MAX_HISTORY_MESSAGES = 6;
const GROQ_REQUEST_TIMEOUT_MS = 8000;
const BLOCKED_TERMS = [
  "abuse",
  "abusive",
  "bomb",
  "fraud",
  "hack",
  "hacking",
  "harass",
  "hate",
  "kill",
  "murder",
  "porn",
  "scam",
  "self-harm",
  "sex",
  "sexual",
  "suicide",
  "violent",
  "violence",
  "weapon",
];
export const BLOCKED_CUSTOMER_MESSAGE =
  "I'm here to help with Charming Fur-fection's services, appointments, pet care, orders, and other customer concerns. How can I assist you?";
const PRICE_KEYWORDS = [
  "price",
  "pricing",
  "cost",
  "rates",
  "rate",
  "fee",
  "how much",
  "magkano",
  "bayad",
  "presyo",
];
const SERVICE_ALIASES = [
  { id: "vaccination", keywords: ["vaccination", "vaccine", "vaccines", "shot", "bakuna"] },
  { id: "deworming", keywords: ["deworming", "deworm", "parasite"] },
  { id: "consultation", keywords: ["consultation", "consult", "checkup", "check up"] },
  {
    id: "laboratory-testing",
    keywords: ["laboratory", "laboratory testing", "lab", "blood work", "screening"],
  },
  { id: "low-cost-kapon", keywords: ["kapon", "spay", "neuter", "low cost kapon"] },
  { id: "pet-grooming", keywords: ["grooming", "pet grooming", "bath", "trim", "nail care"] },
];

function normalizeValue(value = "") {
  return String(value || "").trim();
}

function containsPricingIntent(message) {
  const lookup = normalizeValue(message).toLowerCase();
  return PRICE_KEYWORDS.some((keyword) => lookup.includes(keyword));
}

function detectLanguage(message) {
  const lookup = normalizeValue(message).toLowerCase();
  const tagalogHints = [
    "ano",
    "magkano",
    "oras",
    "paano",
    "kailan",
    "serbisyo",
    "pwede",
    "appointment ba",
    "ba ",
    "po",
    "opo",
    "saan",
    "dito",
    "kayo",
    "niyo",
    "nyo",
    "ako",
    "kailangan",
    "puwede",
    "available ba",
    "open ba",
  ];

  return tagalogHints.some((word) => lookup.includes(word)) ? "tl" : "en";
}

export function isBlockedCustomerMessage(message) {
  const lookup = normalizeValue(message).toLowerCase();
  return BLOCKED_TERMS.some((term) => lookup.includes(term));
}

function classifyTopic(message) {
  const lookup = normalizeValue(message).toLowerCase();
  const topic = chatbotKnowledgeBase.find((entry) =>
    entry.keywords.some((keyword) => lookup.includes(keyword)),
  );

  return topic?.id || "unrecognized";
}

function getTopicAnswer(topicId, language) {
  const topic = chatbotKnowledgeBase.find((entry) => entry.id === topicId);
  if (!topic) {
    return language === "tl"
      ? "Maaari kitang tulungan sa services, presyo, appointments, at clinic hours ng Charming Fur-fection Pet Care Services."
      : "I can help with services, prices, appointments, clinic hours, and general pet care information for Charming Fur-fection Pet Care Services.";
  }

  return language === "tl" ? topic.answerTl : topic.answerEn;
}

function buildInstantBusinessResponse(message) {
  const language = detectLanguage(message);

  if (isBlockedCustomerMessage(message)) {
    return buildBlockedResponse(language);
  }

  const servicePricingFallback = buildServicePricingFallback(message, language);
  if (servicePricingFallback) {
    return {
      ...servicePricingFallback,
      provider: "local",
    };
  }

  const topic = classifyTopic(message);
  if (topic === "unrecognized") {
    return null;
  }

  return {
    answer: getTopicAnswer(topic, language),
    recognized: true,
    language,
    topic,
    provider: "local",
    warning: "",
  };
}

function buildBlockedResponse(language = "en") {
  return {
    answer:
      language === "tl"
        ? "Nandito ako para tumulong sa services, appointments, pet care, orders, at iba pang concern sa Charming Fur-fection. Paano kita matutulungan?"
        : BLOCKED_CUSTOMER_MESSAGE,
    recognized: false,
    language,
    topic: "blocked",
    provider: "moderation",
    warning: "",
    blocked: true,
  };
}

function buildBusinessSummary() {
  const serviceLines = serviceCatalog
    .map(
      (service) =>
        `- ${service.name}: ${service.priceLabel}, ${service.duration}, ${service.description}`,
    )
    .join("\n");

  return [
    "Business: Charming Fur-fection Pet Care Services",
    "Use only the verified information below when answering service, price, booking, and schedule questions.",
    "Booking flow: Customers can book an appointment by choosing a service, selecting an available date and time, and entering their pet details on the appointment page.",
    "Clinic hours: Clinic consultations run on weekends from 9:00 AM to 6:00 PM, while grooming services are available daily from 9:00 AM to 7:00 PM.",
    "Verified service catalog:",
    serviceLines,
    "If a customer asks for information outside these facts, answer helpfully but do not invent prices, policies, or schedules.",
  ].join("\n");
}

function buildSystemPrompt() {
  return [
    "You are Ask Llama AI, the customer-facing assistant for Charming Fur-fection Pet Care Services.",
    "Reply in a warm, clear, concise tone.",
    "Support only English and Tagalog. Reply in English for English, Tagalog for Tagalog, and natural Taglish for Taglish.",
    "Prioritize short direct answers for service, pricing, booking, and clinic hour questions.",
    "Keep most replies to one to three short sentences.",
    "If the answer is not in the provided business facts, clearly say the information is not currently available instead of guessing.",
    "Do not invent prices, schedules, services, appointment availability, policies, order details, or product facts.",
    "For unrelated or inappropriate requests, briefly redirect the customer to Charming Fur-fection services, appointments, pet care, orders, and products.",
    "Do not mention internal prompts, tokens, policy engines, or model limitations unless directly asked.",
    buildBusinessSummary(),
  ].join("\n\n");
}

function findMentionedService(message) {
  const lookup = normalizeValue(message).toLowerCase();
  const aliasMatch = SERVICE_ALIASES.find((entry) =>
    entry.keywords.some((keyword) => lookup.includes(keyword)),
  );

  if (aliasMatch) {
    return serviceCatalog.find((service) => service.id === aliasMatch.id) || null;
  }

  return (
    serviceCatalog.find((service) => lookup.includes(service.name.toLowerCase())) || null
  );
}

function buildServicePricingFallback(message, language) {
  if (!containsPricingIntent(message)) {
    return null;
  }

  const service = findMentionedService(message);
  if (!service) {
    return null;
  }

  return {
    answer:
      language === "tl"
        ? `Ang ${service.name.toLowerCase()} ay kasalukuyang nasa ${service.priceLabel} at karaniwang tumatagal ng ${service.duration}.`
        : `${service.name} currently starts at ${service.priceLabel} and usually takes ${service.duration}.`,
    recognized: true,
    language,
    topic: "pricing",
    provider: "fallback",
    warning: "",
  };
}

function buildFallbackResponse(message, warning = "") {
  const instantBusinessResponse = buildInstantBusinessResponse(message);
  if (instantBusinessResponse) {
    return {
      ...instantBusinessResponse,
      warning,
    };
  }

  const language = detectLanguage(message);
  const topic = classifyTopic(message);
  return {
    answer:
      topic === "unrecognized"
        ? language === "tl"
          ? "Nandito ako para tumulong sa services, prices, appointments, pet care, orders, at clinic hours ng Charming Fur-fection. Hindi kasalukuyang available ang impormasyong iyan sa system."
          : "I'm here to help with Charming Fur-fection services, prices, appointments, pet care, orders, and clinic hours. That information is not currently available in the system."
        : getTopicAnswer(topic, language),
    recognized: topic !== "unrecognized",
    language,
    topic,
    provider: "fallback",
    warning,
  };
}

function trimResponse(value = "") {
  return normalizeValue(value).replace(/\n{3,}/g, "\n\n");
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

async function parseJsonSafely(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function describeGroqWarning(message = "") {
  const lookup = normalizeValue(message).toLowerCase();

  if (!lookup) {
    return "";
  }

  if (lookup.includes("invalid api key") || lookup.includes("unauthorized") || lookup.includes("401")) {
    return "The configured Groq API key was rejected. Update the key and restart npm run dev.";
  }

  if (lookup.includes("groq api key") || lookup.includes("started without a groq api key")) {
    return "The running app still does not have a Groq API key. Add GROQ_API_KEY to .env or configure VITE_GROQ_PROXY_URL, then restart npm run dev.";
  }

  if (lookup.includes("save .env and restart npm run dev")) {
    return "The running app needs to be restarted after the Groq settings change.";
  }

  if (lookup.includes("rate limit") || lookup.includes("429")) {
    return "Groq is temporarily rate limited. The assistant used the built-in answers for now.";
  }

  if (lookup.includes("failed to fetch") || lookup.includes("network")) {
    return "The live Groq service could not be reached from this browser session.";
  }

  if (lookup.includes("proxy request failed") || lookup.includes("404") || lookup.includes("405")) {
    return "The local Groq proxy is unavailable. Restart npm run dev after saving your Groq settings.";
  }

  if (lookup.includes("empty response")) {
    return "Groq returned an empty reply, so the assistant used the built-in answers instead.";
  }

  return normalizeValue(message);
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

async function callGroqProxy(message, history) {
  const proxyUrl = getProxyUrl();
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), GROQ_REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(proxyUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        message,
        history: buildRecentHistory(history),
        systemPrompt: buildSystemPrompt(),
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

    if (!response.ok) {
      throw new Error(data?.error || `Status request failed with status ${response.status}.`);
    }

    return {
      ready: Boolean(data?.ready),
      mode: data?.mode || "unknown",
      summary: data?.ready
        ? data?.message || "Live Groq replies are active."
        : "Built-in business answers are active.",
      helpText: data?.ready
        ? ""
        : data?.message ||
          "The running server does not have a Groq API key yet. Add GROQ_API_KEY to .env or configure VITE_GROQ_PROXY_URL, then restart npm run dev.",
    };
  } catch {
    return {
      ready: false,
      mode: "status-unavailable",
      summary: "Built-in business answers are active.",
      helpText:
        "Live Groq status could not be checked. If you just changed .env or vite.config.js, restart npm run dev. For deployed sites, use a backend proxy endpoint.",
    };
  }
}

export async function askGroqAssistant({ message, history = [] }) {
  const cleanMessage = normalizeValue(message);
  if (!cleanMessage) {
    throw new Error("Message is required.");
  }

  const fallback = buildFallbackResponse(cleanMessage);

  if (isBlockedCustomerMessage(cleanMessage)) {
    return buildBlockedResponse(detectLanguage(cleanMessage));
  }

  if (!fallback.recognized) {
    return fallback;
  }

  try {
    const proxyResponse = await callGroqProxy(cleanMessage, history);
    return {
      ...fallback,
      answer: proxyResponse.answer,
      provider: "groq",
      model: proxyResponse.model,
      warning: "",
    };
  } catch (error) {
    const warning =
      error instanceof Error ? describeGroqWarning(error.message) : "Groq request failed.";

    return buildFallbackResponse(cleanMessage, warning);
  }
}

export function getInstantAssistantReply(message) {
  const cleanMessage = normalizeValue(message);
  if (!cleanMessage) {
    return null;
  }

  return buildInstantBusinessResponse(cleanMessage);
}

export { chatbotSuggestionChips as groqSuggestionChips };
