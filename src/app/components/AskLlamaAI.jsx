import { useEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { AnimatePresence, motion } from "motion/react";
import {
  Bot,
  LoaderCircle,
  MessageCircleMore,
  SendHorizontal,
  Sparkles,
  X,
} from "lucide-react";
import { useApp } from "../context/AppContext.jsx";
import {
  askGroqAssistantStream,
  getGroqRuntimeStatus,
  groqSuggestionChips,
} from "../../services/groq.js";

const INTRO_MESSAGE = {
  id: "assistant-intro",
  from: "assistant",
  content:
    "Hello! I'm Ask Llama AI for Charming Fur-fection Pet Care Services. Ask me about services, prices, appointments, or clinic hours.",
};

function createMessage(from, content, meta = {}) {
  return {
    id: `${from}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    from,
    content,
    ...meta,
  };
}

function shouldRenderWidget(pathname) {
  if (!pathname) {
    return true;
  }

  if (
    pathname === "/login" ||
    pathname === "/customer/login" ||
    pathname === "/admin/login" ||
    pathname === "/staff/login" ||
    pathname === "/verify-otp" ||
    pathname === "/unauthorized"
  ) {
    return false;
  }

  return true;
}

function resolveSource(pathname) {
  if (!pathname || pathname === "/") {
    return "home";
  }

  return pathname.replace(/^\//, "") || "app";
}

function ChatBubble({ message }) {
  const isUser = message.from === "user";

  return (
    <div className={`flex min-w-0 ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[90%] min-w-0 rounded-[24px] px-4 py-3 text-sm leading-6 shadow-sm ${
          isUser
            ? "bg-gradient-to-r from-[#6D37FF] to-[#9557FF] text-white"
            : "border border-[#EEE5FF] bg-white text-[#30254D]"
        }`}
      >
        <p className="whitespace-pre-wrap break-words">{message.content}</p>
      </div>
    </div>
  );
}

export function AskLlamaAI() {
  const { logChatbotInquiry } = useApp();
  const location = useLocation();
  const pathname = location.pathname || "/";
  const [isOpen, setIsOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [messages, setMessages] = useState([INTRO_MESSAGE]);
  const [isLoading, setIsLoading] = useState(false);
  const [showLoadingIndicator, setShowLoadingIndicator] = useState(false);
  const [lastWarning, setLastWarning] = useState("");
  const [groqStatus, setGroqStatus] = useState({
    ready: false,
    summary: "Checking live Groq status...",
    helpText: "",
  });
  const endOfMessagesRef = useRef(null);
  const inputRef = useRef(null);
  const messagesViewportRef = useRef(null);
  const requestInFlightRef = useRef(false);
  const lastSubmissionRef = useRef({ message: "", at: 0 });
  const activeRequestIdRef = useRef(0);
  const mountedRef = useRef(true);
  const loadingIndicatorTimeoutRef = useRef(null);

  function clearLoadingIndicatorTimer() {
    if (loadingIndicatorTimeoutRef.current) {
      window.clearTimeout(loadingIndicatorTimeoutRef.current);
      loadingIndicatorTimeoutRef.current = null;
    }
  }

  function scrollMessagesToBottom(behavior = "smooth") {
    const viewport = messagesViewportRef.current;
    if (!viewport) {
      return;
    }

    window.requestAnimationFrame(() => {
      viewport.scrollTo({
        top: viewport.scrollHeight,
        behavior,
      });
    });
  }

  useEffect(() => {
    return () => {
      clearLoadingIndicatorTimer();
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function loadGroqStatus() {
      const status = await getGroqRuntimeStatus();
      if (!cancelled) {
        setGroqStatus(status);
      }
    }

    loadGroqStatus();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    scrollMessagesToBottom(messages.length > 1 ? "smooth" : "auto");
  }, [messages, isLoading, isOpen]);

  useEffect(() => {
    if (isOpen) {
      inputRef.current?.focus();
    }
  }, [isOpen]);

  useEffect(() => {
    const textarea = inputRef.current;
    if (!textarea) {
      return;
    }

    textarea.style.height = "0px";
    textarea.style.height = `${Math.min(textarea.scrollHeight, 120)}px`;
  }, [draft, isOpen]);

  if (!shouldRenderWidget(pathname)) {
    return null;
  }

  function isDuplicateSubmission(message) {
    const now = Date.now();
    if (
      lastSubmissionRef.current.message === message &&
      now - lastSubmissionRef.current.at < 600
    ) {
      return true;
    }

    lastSubmissionRef.current = { message, at: now };
    return false;
  }

  async function submitMessage(rawMessage) {
    const cleanMessage = rawMessage.trim();
    if (!cleanMessage || isLoading || requestInFlightRef.current) {
      return;
    }

    if (isDuplicateSubmission(cleanMessage)) {
      return;
    }

    requestInFlightRef.current = true;
    activeRequestIdRef.current += 1;
    const requestId = activeRequestIdRef.current;

    const userMessage = createMessage("user", cleanMessage);
    const assistantMessage = createMessage("assistant", "", {
      provider: "groq",
      topic: "dynamic",
    });
    const assistantId = assistantMessage.id;

    const history = messages.map((message) => ({
      role: message.from === "assistant" ? "assistant" : "user",
      content: message.content,
    }));

    setMessages((current) => [...current, userMessage, assistantMessage]);
    setDraft("");
    setIsOpen(true);
    setIsLoading(true);
    setShowLoadingIndicator(false);
    setLastWarning("");
    clearLoadingIndicatorTimer();
    loadingIndicatorTimeoutRef.current = window.setTimeout(() => {
      if (mountedRef.current && requestId === activeRequestIdRef.current) {
        setShowLoadingIndicator(true);
      }
    }, 180);

    try {
      const result = await askGroqAssistantStream({
        message: cleanMessage,
        history,
        onToken: (token) => {
          if (!mountedRef.current || requestId !== activeRequestIdRef.current) {
            return;
          }

          setMessages((current) =>
            current.map((message) =>
              message.id === assistantId
                ? { ...message, content: `${message.content}${token}` }
                : message,
            ),
          );
        },
      });

      if (!mountedRef.current || requestId !== activeRequestIdRef.current) {
        return;
      }

      setMessages((current) =>
        current.map((message) =>
          message.id === assistantId
            ? {
                ...message,
                content: result.answer,
                provider: result.provider,
                topic: result.topic,
              }
            : message,
        ),
      );
      setLastWarning(result.warning || "");
      logChatbotInquiry({
        question: cleanMessage,
        response: result.answer,
        recognized: result.recognized,
        language: result.language,
        topic: result.topic,
        provider: result.provider,
        model: result.model || null,
        source: resolveSource(pathname),
      });

      if (result.warning) {
        const status = await getGroqRuntimeStatus();
        if (mountedRef.current && requestId === activeRequestIdRef.current) {
          setGroqStatus(status);
        }
      } else {
        setGroqStatus((current) => ({
          ...current,
          ready: true,
          summary: "Live Groq replies are active.",
          helpText: "",
        }));
      }
    } catch (error) {
      const fallbackMessage =
        "I couldn't process that request right now. Please try again in a moment.";

      if (!mountedRef.current || requestId !== activeRequestIdRef.current) {
        return;
      }

      setMessages((current) =>
        current.map((message) =>
          message.id === assistantId ? { ...message, content: fallbackMessage } : message,
        ),
      );
      setLastWarning(error instanceof Error ? error.message : "Unknown chat error.");
    } finally {
      clearLoadingIndicatorTimer();
      requestInFlightRef.current = false;
      if (mountedRef.current) {
        setIsLoading(false);
        setShowLoadingIndicator(false);
      }
    }
  }

  return (
    <div className="pointer-events-none fixed bottom-3 right-3 z-[80] flex w-[min(408px,calc(100vw-0.75rem))] flex-col items-end sm:bottom-4 sm:right-5 sm:w-[min(408px,calc(100vw-1.5rem))]">
      <AnimatePresence>
        {isOpen && (
          <motion.section
            initial={{ opacity: 0, y: 18, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 18, scale: 0.97 }}
            transition={{ duration: 0.22, ease: "easeOut" }}
            className="pointer-events-auto mb-3 flex h-[min(700px,calc(100dvh-5.5rem))] w-full flex-col overflow-hidden rounded-[32px] border border-white/75 bg-white/95 shadow-[0_32px_72px_rgba(65,34,142,0.22)] backdrop-blur sm:mb-4 sm:h-[min(740px,calc(100dvh-6.5rem))]"
          >
            <div className="shrink-0 border-b border-[#F0E9FF] bg-[linear-gradient(180deg,rgba(247,243,255,0.96)_0%,rgba(255,255,255,0.94)_100%)] px-5 py-5 sm:px-6 sm:py-6">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="inline-flex items-center gap-2 rounded-full bg-[#F3ECFF] px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-[#6D37FF]">
                    <Sparkles size={14} />
                    Ask Llama AI
                  </div>
                  <h3 className="mt-3 text-xl font-semibold text-[#2E2450]">
                    Charming Fur-fection Assistant
                  </h3>
                  <p className="mt-1 text-sm leading-6 text-[#6E638A]">
                    {groqStatus.ready ? "Live Groq replies are active." : groqStatus.summary}
                  </p>
                </div>

                <button
                  type="button"
                  onClick={() => setIsOpen(false)}
                  className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-white text-[#5D4B8A] shadow-[0_8px_20px_rgba(141,99,255,0.16)] transition hover:bg-[#F6F2FF]"
                  aria-label="Close Ask Llama AI"
                >
                  <X size={18} />
                </button>
              </div>

              <div
                className={`mt-4 inline-flex items-center rounded-full px-3 py-1.5 text-xs font-semibold ${
                  groqStatus.ready
                    ? "bg-[#E9FAF4] text-[#1F7A58]"
                    : "bg-[#FFF6E6] text-[#8A6330]"
                }`}
              >
                {groqStatus.ready ? "Live Groq + Llama" : "Live Groq unavailable"}
              </div>
            </div>

            <div className="flex min-h-0 flex-1 flex-col px-4 pb-4 sm:px-5 sm:pb-5">
              <div className="mt-4 flex min-h-0 flex-1 flex-col overflow-hidden rounded-[28px] border border-[#F0E9FF] bg-[#FCFBFF]">
                <div
                  ref={messagesViewportRef}
                  role="log"
                  aria-live="polite"
                  aria-busy={isLoading}
                  className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain px-4 py-4 pr-3 scroll-smooth sm:px-5 sm:py-5 sm:pr-4"
                >
                  {messages.map((message) => (
                    <ChatBubble key={message.id} message={message} />
                  ))}

                  {isLoading && showLoadingIndicator && (
                    <div className="flex justify-start">
                      <div className="inline-flex items-center gap-2 rounded-[24px] border border-[#EEE5FF] bg-white px-4 py-3 text-sm text-[#5E4C89] shadow-sm">
                        <LoaderCircle size={16} className="animate-spin" />
                        Llama is thinking...
                      </div>
                    </div>
                  )}

                  <div ref={endOfMessagesRef} />
                </div>
              </div>

              <div className="mt-3 shrink-0 space-y-3">
                <div className="-mx-1 overflow-x-auto overflow-y-hidden px-1 pb-1 scroll-smooth">
                  <div className="flex w-max min-w-full gap-2">
                    {groqSuggestionChips.map((chip) => (
                      <button
                        key={chip}
                        type="button"
                        onClick={() => submitMessage(chip)}
                        disabled={isLoading}
                        className="shrink-0 rounded-full border border-[#E7DEFF] bg-[#FBF9FF] px-3 py-2 text-xs font-medium text-[#5D4B8A] transition hover:border-[#CDBBFF] hover:bg-[#F6F1FF] disabled:cursor-not-allowed disabled:opacity-70"
                      >
                        {chip}
                      </button>
                    ))}
                  </div>
                </div>

                {lastWarning && (
                  <div className="rounded-[22px] border border-[#F4DFC0] bg-[#FFF8EE] px-4 py-3 text-xs leading-5 text-[#8A6330]">
                    Live Groq reply is unavailable right now. Details: {lastWarning}
                  </div>
                )}

                {!groqStatus.ready && !lastWarning && groqStatus.helpText && (
                  <div className="rounded-[22px] border border-[#ECE4FF] bg-[#F8F5FF] px-4 py-3 text-xs leading-5 text-[#716689]">
                    {groqStatus.helpText}
                  </div>
                )}

                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    submitMessage(draft);
                  }}
                >
                  <div className="flex items-end gap-3 rounded-[26px] border border-[#E4D7FF] bg-[#FCFBFF] px-4 py-3 transition focus-within:border-[#8D63FF] focus-within:shadow-[0_0_0_4px_rgba(141,99,255,0.12)]">
                    <textarea
                      ref={inputRef}
                      rows={1}
                      value={draft}
                      onChange={(event) => setDraft(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" && !event.shiftKey) {
                          event.preventDefault();
                          submitMessage(draft);
                        }
                      }}
                      placeholder="Ask about services, prices, booking, or clinic hours"
                      className="min-h-[24px] max-h-[120px] flex-1 resize-none bg-transparent text-sm leading-6 text-[#30254D] outline-none placeholder:text-[#9C8FBC]"
                    />

                    <button
                      type="submit"
                      disabled={isLoading || !draft.trim()}
                      className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-gradient-to-r from-[#6D37FF] to-[#9557FF] text-white shadow-[0_18px_35px_rgba(109,55,255,0.35)] transition hover:scale-[1.02] disabled:cursor-not-allowed disabled:opacity-70"
                      aria-label="Send message to Ask Llama AI"
                    >
                      {isLoading ? (
                        <LoaderCircle size={18} className="animate-spin" />
                      ) : (
                        <SendHorizontal size={18} />
                      )}
                    </button>
                  </div>

                  <p className="mt-2 text-xs text-[#8B81A4]">
                    Press Enter to send. Use Shift+Enter for a new line.
                  </p>
                </form>
              </div>
            </div>
          </motion.section>
        )}
      </AnimatePresence>

      <button
        type="button"
        onClick={() => setIsOpen((current) => !current)}
        className="pointer-events-auto inline-flex items-center gap-2 rounded-full bg-gradient-to-r from-[#6D37FF] to-[#9557FF] px-5 py-3.5 text-sm font-semibold text-white shadow-[0_18px_35px_rgba(109,55,255,0.35)] transition hover:translate-y-[-1px]"
      >
        {isOpen ? <Bot size={16} /> : <MessageCircleMore size={16} />}
        Ask Llama AI
      </button>
    </div>
  );
}

export default AskLlamaAI;
