import { useEffect, useRef } from "react";
import { X } from "lucide-react";
import { privacyPolicyText, termsAndConditionsText } from "../utils/policyDocuments.js";
import { reachedPolicyBottom } from "../utils/policyAgreement.js";
import { formatPolicyContent } from "../utils/policyText.mjs";

export function PolicyDialog({ documentType, onClose, onReachedBottom, footer }) {
  const contentRef = useRef(null);
  const isTerms = documentType === "terms";
  const title = isTerms ? "Terms and Conditions" : "Privacy Policy";
  const content = isTerms ? termsAndConditionsText : privacyPolicyText;
  const blocks = formatPolicyContent(content);

  useEffect(() => {
    if (contentRef.current) contentRef.current.scrollTop = 0;
  }, [documentType]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#102D32]/60 p-3 sm:p-5" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section role="dialog" aria-modal="true" aria-labelledby="policy-dialog-title" className="flex max-h-[calc(100dvh-1.5rem)] w-full max-w-4xl flex-col overflow-hidden rounded-3xl bg-white p-4 shadow-2xl sm:max-h-[calc(100dvh-2.5rem)] sm:p-6">
        <div className="flex shrink-0 items-center justify-between gap-4">
          <h2 id="policy-dialog-title" className="text-xl font-semibold text-[#20343B] sm:text-2xl">{title}</h2>
          <button type="button" onClick={onClose} aria-label={`Close ${title}`} className="shrink-0 rounded-full p-2 text-[#607277] hover:bg-[#F1F7F7]"><X size={20} /></button>
        </div>
        {onReachedBottom && <p className="mt-1 shrink-0 text-sm text-[#607277]">Scroll to the bottom to enable account creation.</p>}
        <div
          ref={contentRef}
          aria-label={`${title} document`}
          className="mt-4 min-h-0 flex-1 overflow-y-auto overscroll-contain rounded-2xl border border-[#D9E7E7] bg-[#F8FCFC] p-4 text-[15px] leading-7 text-[#4E6469] sm:p-6"
          onScroll={(event) => {
            if (onReachedBottom && reachedPolicyBottom(event.currentTarget)) onReachedBottom();
          }}
        >
          {blocks.map(({ kind, value }, index) => {
            if (kind === "heading") return <h3 key={`${index}-${value}`} className="mb-3 mt-5 text-lg font-semibold leading-7 text-[#20343B] first:mt-0">{value}</h3>;
            if (kind === "subheading") return <h4 key={`${index}-${value}`} className="mb-2 mt-4 text-base font-semibold leading-7 text-[#365057]">{value}</h4>;
            return <p key={`${index}-${value}`} className={`mb-3 ${kind === "list" ? "pl-4" : ""}`}>{value}</p>;
          })}
        </div>
        {footer || <button type="button" onClick={onClose} className="mt-4 w-full shrink-0 rounded-xl bg-[#2D9B9B] px-5 py-3 text-sm font-semibold text-white">Close</button>}
      </section>
    </div>
  );
}
