import { useEffect, useRef } from "react";
import { X } from "lucide-react";
import policyText from "../data/terms-and-privacy.txt?raw";

const [termsText, privacyText = ""] = policyText.split(/(?:\r?\n|\f)+Privacy Policy(?:\r?\n|\f)+/);

export function PolicyDialog({ title = "Terms and Conditions and Privacy Policy", initialDocument = "terms", onClose, onReadToBottom, footer }) {
  const contentRef = useRef(null);
  useEffect(() => {
    if (initialDocument === "privacy") {
      const container = contentRef.current;
      const section = container?.querySelector("#privacy-policy-document");
      if (container && section) container.scrollTop = section.offsetTop - container.offsetTop;
    }
  }, [initialDocument]);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#102D32]/60 p-3 sm:p-4" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section role="dialog" aria-modal="true" aria-labelledby="policy-dialog-title" className="flex max-h-[calc(100dvh-1.5rem)] w-full max-w-2xl flex-col rounded-3xl bg-white p-4 shadow-2xl sm:max-h-[calc(100dvh-2rem)] sm:p-6">
        <div className="flex shrink-0 items-start justify-between gap-4">
          <div>
            <h2 id="policy-dialog-title" className="text-xl font-semibold text-[#20343B]">{title}</h2>
            {onReadToBottom && <p className="mt-1 text-sm text-[#607277]">Scroll to the bottom to enable account creation.</p>}
          </div>
          <button type="button" onClick={onClose} aria-label="Close terms and privacy policy" className="shrink-0 rounded-full p-2 text-[#607277] hover:bg-[#F1F7F7]"><X size={20} /></button>
        </div>
        <div
          ref={contentRef}
          className="mt-4 min-h-0 flex-1 overflow-y-auto rounded-2xl border border-[#D9E7E7] bg-[#F8FCFC] p-4 text-sm leading-6 text-[#607277] sm:p-5"
          onScroll={onReadToBottom ? (event) => {
            const element = event.currentTarget;
            if (element.scrollTop + element.clientHeight >= element.scrollHeight - 4) onReadToBottom();
          } : undefined}
        >
          <div id="terms-and-conditions-document" className="whitespace-pre-wrap break-words">{termsText}</div>
          <div id="privacy-policy-document" className="mt-6 whitespace-pre-wrap break-words">Privacy Policy{"\n"}{privacyText}</div>
        </div>
        {footer || (!onReadToBottom && <button type="button" onClick={onClose} className="mt-4 w-full shrink-0 rounded-xl bg-[#2D9B9B] px-5 py-2.5 text-sm font-semibold text-white">Close</button>)}
      </section>
    </div>
  );
}
