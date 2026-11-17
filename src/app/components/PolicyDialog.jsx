import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { privacyPolicyText, termsAndConditionsText } from "../utils/policyDocuments.js";
import { reachedPolicyBottom } from "../utils/policyAgreement.js";
import { formatPolicyContent } from "../utils/policyText.mjs";

export function PolicyDialog({ documentType, onClose, onReachedBottom, footer }) {
  const contentRef = useRef(null);
  const reachedBottomRef = useRef(false);
  const dialogRef = useRef(null);
  const isCombined = documentType === "combined";
  const isTerms = documentType === "terms";
  const title = isCombined ? "Terms and Conditions and Privacy Policy" : isTerms ? "Terms and Conditions" : "Privacy Policy";
  const documents = isCombined
    ? [
        { title: "Terms and Conditions", text: termsAndConditionsText },
        { title: "Privacy Policy", text: privacyPolicyText },
      ]
    : [{ title, text: isTerms ? termsAndConditionsText : privacyPolicyText }];

  useEffect(() => {
    const dialog = dialogRef.current;
    const previousOverflow = document.body.style.overflow;
    dialog.showModal();
    document.body.style.overflow = "hidden";
    return () => {
      dialog.close();
      document.body.style.overflow = previousOverflow;
    };
  }, [documentType]);

  return typeof document === "undefined" ? null : createPortal(
      <dialog
        ref={dialogRef}
        aria-modal="true"
        aria-labelledby="policy-dialog-title"
        onCancel={(event) => { event.preventDefault(); onClose(); }}
        onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}
        className="fixed inset-0 m-auto flex h-[calc(100dvh-2rem)] max-h-[52rem] w-[calc(100%-2rem)] max-w-4xl flex-col overflow-hidden rounded-3xl border border-[#D9E7E7] bg-white p-4 shadow-2xl backdrop:bg-[#102D32]/60 sm:h-[calc(100dvh-3rem)] sm:w-[calc(100%-3rem)] sm:p-6"
        style={{ display: "flex", boxSizing: "border-box", width: "min(calc(100vw - 2rem), 56rem)", height: "min(calc(100dvh - 2rem), 52rem)", maxWidth: "calc(100vw - 2rem)", maxHeight: "calc(100dvh - 2rem)", flexDirection: "column", overflow: "hidden" }}
      >
        <div className="flex shrink-0 items-center justify-between gap-4" style={{ flexShrink: 0 }}>
          <h2 id="policy-dialog-title" className="min-w-0 text-lg font-semibold leading-6 text-[#20343B] sm:text-2xl sm:leading-8">{title}</h2>
          <button type="button" onClick={onClose} aria-label={`Close ${title}`} className="shrink-0 rounded-full p-2 text-[#607277] hover:bg-[#F1F7F7]"><X size={20} /></button>
        </div>
        {onReachedBottom && <p className="mt-1 shrink-0 text-sm text-[#607277]" style={{ flexShrink: 0 }}>{isCombined ? "Scroll through both documents to enable account creation." : "Scroll to the bottom to enable account creation."}</p>}
        <div
          ref={contentRef}
          aria-label={isCombined ? "Combined policy documents" : `${title} document`}
          className="mt-3 min-h-0 flex-1 overflow-y-auto overscroll-contain rounded-2xl border border-[#D9E7E7] bg-[#F8FCFC] p-4 text-[15px] leading-7 text-[#4E6469] sm:mt-4 sm:p-6"
          style={{ flex: "1 1 0%", minHeight: 0, overflowY: "auto" }}
          onScroll={(event) => {
            if (onReachedBottom && !reachedBottomRef.current && reachedPolicyBottom(event.currentTarget)) {
              reachedBottomRef.current = true;
              onReachedBottom();
            }
          }}
        >
          {documents.map(({ title: documentTitle, text }) => (
            <section key={documentTitle} aria-label={`${documentTitle} full text`} data-policy-document={documentTitle} className="mb-8 last:mb-0">
              {formatPolicyContent(text).map(({ kind, value }, index) => {
                if (kind === "heading") return <h3 key={`${index}-${value}`} className="mb-3 mt-5 text-lg font-semibold leading-7 text-[#20343B] first:mt-0">{value}</h3>;
                if (kind === "subheading") return <h4 key={`${index}-${value}`} className="mb-2 mt-4 text-base font-semibold leading-7 text-[#365057]">{value}</h4>;
                return <p key={`${index}-${value}`} className={`mb-3 ${kind === "list" ? "pl-4" : ""}`}>{value}</p>;
              })}
            </section>
          ))}
        </div>
        <div style={{ flexShrink: 0 }}>{footer || <button type="button" onClick={onClose} className="mt-3 w-full shrink-0 rounded-xl bg-[#2D9B9B] px-5 py-3 text-sm font-semibold text-white sm:mt-4">Close</button>}</div>
      </dialog>, document.body,
  );
}
