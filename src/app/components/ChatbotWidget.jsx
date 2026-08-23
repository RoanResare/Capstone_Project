import { useRef, useState } from "react";
import { Bot, Languages, SendHorizontal } from "lucide-react";
import {
  chatbotKnowledgeBase,
  chatbotSuggestionChips,
} from "../data/systemData.js";
import { useApp } from "../context/AppContext.jsx";
import {
  BLOCKED_CUSTOMER_MESSAGE,
  isBlockedCustomerMessage,
} from "../../services/groq.js";

function normalizeValue(value = "") {
  return value.trim().toLowerCase();
}

function detectLanguage(message) {
  const lookup = normalizeValue(message);
  const tagalogHints = [
    "ano",
    "magkano",
    "oras",
    "paano",
    "kailan",
    "serbisyo",
    "bukas",
    "pwede",
  ];

  return tagalogHints.some((word) => lookup.includes(word)) ? "tl" : "en";
}

function resolveChatReply(message) {
  const language = detectLanguage(message);

  const lookup = normalizeValue(message);
  const topic = chatbotKnowledgeBase.find((entry) =>
    entry.keywords.some((keyword) => lookup.includes(keyword)),
  );

  if (!topic) {
    return {
      recognized: false,
      language,
      topic: "unrecognized",
      answer:
        language === "tl"
          ? "Hindi ko pa maintindihan ang tanong na iyon. Subukang magtanong tungkol sa services, presyo, appointments, policies, o clinic hours."
          : "I could not understand that question yet. Try asking about services, pricing, appointments, policies, or clinic hours.",
    };
  }

  return {
    recognized: true,
    language,
    topic: topic.id,
    answer: language === "tl" ? topic.answerTl : topic.answerEn,
  };
}

function ChatBubble({ from, children }) {
  const isUser = from === "user";

  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[88%] rounded-[22px] px-4 py-3 text-sm leading-6 ${
          isUser
            ? "bg-[#173E44] text-white"
            : "bg-[#F3F8F8] text-[#27484E]"
        }`}
      >
        {children}
      </div>
    </div>
  );
}

export function ChatbotWidget({ surface = "home" }) {
  const { logChatbotInquiry } = useApp();
  const [draft, setDraft] = useState("");
  const lastSubmissionRef = useRef({ message: "", at: 0 });
  const [messages, setMessages] = useState([
    {
      id: "assistant-intro",
      from: "assistant",
      content:
        "Hello! Ask about services, pricing, appointments, clinic hours, or policies in English or Tagalog.",
    },
  ]);

  const isSubmitDisabled = !draft.trim();

  const isDuplicateSubmission = (message) => {
    const now = Date.now();
    if (
      lastSubmissionRef.current.message === message &&
      now - lastSubmissionRef.current.at < 600
    ) {
      return true;
    }

    lastSubmissionRef.current = { message, at: now };
    return false;
  };

  const submitInquiry = (message) => {
    const cleanMessage = message.trim();
    if (!cleanMessage) {
      return;
    }

    if (isDuplicateSubmission(cleanMessage)) {
      return;
    }

    if (isBlockedCustomerMessage(cleanMessage)) {
      setMessages((current) => [
        ...current,
        {
          id: `assistant-${Date.now()}`,
          from: "assistant",
          content: BLOCKED_CUSTOMER_MESSAGE,
        },
      ]);
      setDraft("");
      return;
    }

    const reply = resolveChatReply(cleanMessage);
    const userMessage = {
      id: `user-${Date.now()}`,
      from: "user",
      content: cleanMessage,
    };
    const assistantMessage = {
      id: `assistant-${Date.now() + 1}`,
      from: "assistant",
      content: reply.answer,
    };

    setMessages((current) => [...current, userMessage, assistantMessage]);
    setDraft("");
    logChatbotInquiry({
      question: cleanMessage,
      response: reply.answer,
      recognized: reply.recognized,
      language: reply.language,
      topic: reply.topic,
      source: surface,
    });
  };

  return (
    <section className="rounded-[30px] border border-[#DDEAEA] bg-white p-6 shadow-[0_18px_36px_rgba(77,94,91,0.1)]">
      <div className="flex flex-col gap-3 border-b border-[#E8EFEE] pb-5 md:flex-row md:items-center md:justify-between">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full bg-[#EEF7F7] px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-[#2D6B73]">
            <Bot size={14} />
            AI Chatbot
          </div>
          <h3 className="mt-3 text-2xl font-semibold text-[#20343B]">
            Instant help for appointments and clinic questions
          </h3>
        </div>
        <div className="inline-flex items-center gap-2 rounded-full bg-[#F7F3EA] px-4 py-2 text-sm font-medium text-[#6B6254]">
          <Languages size={16} />
          English and Tagalog
        </div>
      </div>

      <div className="mt-5 space-y-3 rounded-[26px] bg-[#FCFEFE] p-4">
        {messages.map((message) => (
          <ChatBubble key={message.id} from={message.from}>
            {message.content}
          </ChatBubble>
        ))}
      </div>

      <div className="mt-5 flex flex-wrap gap-2">
        {chatbotSuggestionChips.map((chip) => (
          <button
            key={chip}
            type="button"
            onClick={() => submitInquiry(chip)}
            className="rounded-full border border-[#D9E8E8] bg-[#F9FBFB] px-4 py-2 text-sm text-[#36555B] transition hover:border-[#2D9B9B] hover:text-[#2D6B73]"
          >
            {chip}
          </button>
        ))}
      </div>

      <form
        onSubmit={(event) => {
          event.preventDefault();
          submitInquiry(draft);
        }}
        className="mt-5 flex flex-col gap-3 md:flex-row"
      >
        <input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="Ask about services, prices, schedules, policies, or appointments"
          className="min-w-0 flex-1 rounded-[22px] border border-[#D8E6E6] px-4 py-3 outline-none transition focus:border-[#2D9B9B]"
        />
        <button
          type="submit"
          disabled={isSubmitDisabled}
          className="inline-flex items-center justify-center gap-2 rounded-[22px] bg-[#173E44] px-5 py-3 text-sm font-semibold text-white transition hover:bg-[#1F5159]"
        >
          Ask chatbot
          <SendHorizontal size={16} />
        </button>
      </form>
    </section>
  );
}
