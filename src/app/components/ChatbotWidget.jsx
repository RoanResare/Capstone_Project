import { useRef, useState } from "react";
import { Bot, Languages, SendHorizontal } from "lucide-react";
import { Link } from "react-router-dom";
import {
  chatbotSuggestionChips,
} from "../data/systemData.js";
import { useApp } from "../context/AppContext.jsx";
import {
  askGroqAssistant,
} from "../../services/groq.js";

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
  const requestInFlightRef = useRef(false);
  const [isLoading, setIsLoading] = useState(false);
  const [messages, setMessages] = useState([
    {
      id: "assistant-intro",
      from: "assistant",
      content:
        "Hello! Ask about services, pricing, appointments, clinic hours, or policies in English or Tagalog.",
    },
  ]);

  const isSubmitDisabled = isLoading || !draft.trim();

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

  const submitInquiry = async (message) => {
    const cleanMessage = message.trim();
    if (!cleanMessage || requestInFlightRef.current) {
      return;
    }

    if (isDuplicateSubmission(cleanMessage)) {
      return;
    }

    requestInFlightRef.current = true;
    setIsLoading(true);
    const history = messages.slice(1).map(({ from, content }) => ({
      role: from === "user" ? "user" : "assistant", content,
    }));
    const userMessage = {
      id: `user-${Date.now()}`,
      from: "user",
      content: cleanMessage,
    };
    setMessages((current) => [...current, userMessage]);
    setDraft("");
    try {
      // The existing service owns timeouts and provider-unavailable fallbacks.
      const reply = await askGroqAssistant({ message: cleanMessage, history });
      setMessages((current) => [...current, {
        id: `assistant-${Date.now()}`, from: "assistant", content: reply.answer,
        bookingLink: /\b(book|booking|appointment|schedule|reserve|reservation|magpa|iskedyul)\b/i.test(cleanMessage),
      }]);
      logChatbotInquiry({
        question: cleanMessage,
        response: reply.answer,
        recognized: reply.recognized,
        language: reply.language,
        topic: reply.topic,
        provider: reply.provider,
        model: reply.model || null,
        source: surface,
      });
    } finally {
      requestInFlightRef.current = false;
      setIsLoading(false);
    }
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
            <p className="whitespace-pre-wrap break-words">{message.content}</p>
            {message.bookingLink && (
              <Link to="/customer/dashboard?tab=services" className="mt-3 block font-semibold underline underline-offset-4">
                Book an appointment
              </Link>
            )}
          </ChatBubble>
        ))}
        {isLoading && <p role="status" className="text-sm text-[#607277]">Charming Assistant is thinking...</p>}
      </div>

      <div className="mt-5 flex flex-wrap gap-2">
        {chatbotSuggestionChips.map((chip) => (
          <button
            key={chip}
            type="button"
            disabled={isLoading}
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
