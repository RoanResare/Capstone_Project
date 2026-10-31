import { resetAllBrowserState } from "../utils/browserState.js";

function normalizeDetail(detail) {
  if (!detail) {
    return "Unknown browser-side error.";
  }

  if (typeof detail === "string") {
    return detail;
  }

  if (detail instanceof Error) {
    return detail.message || detail.name || "Unknown browser-side error.";
  }

  return String(detail);
}

export function RecoveryScreen({
  eyebrow = "Render Recovery",
  title = "The page hit a browser-side error before the UI could load.",
  message = "Resetting the saved browser data usually clears stale state conflicts and reloads the latest interface safely.",
  detail,
}) {
  const detailMessage = normalizeDetail(detail);

  const handleReset = () => {
    resetAllBrowserState();
    window.location.reload();
  };

  return (
    <div className="min-h-screen bg-[#F6F0E7] px-4 py-8 text-[#20343B] sm:px-6 sm:py-12">
      <div className="mx-auto max-w-3xl rounded-[28px] border border-[#E7ECE9] bg-white p-5 shadow-[0_14px_32px_rgba(54,67,62,0.09)] sm:p-8">
        <p className="text-sm font-semibold uppercase tracking-[0.18em] text-[#7B9A9F]">
          {eyebrow}
        </p>
        <h1 className="mt-3 text-2xl font-semibold sm:text-3xl">{title}</h1>
        <p className="mt-4 text-base leading-7 text-[#607277]">{message}</p>
        <div className="mt-6 rounded-[24px] bg-[#F8FBFB] px-5 py-4 text-sm text-[#4C6368]">
          {detailMessage}
        </div>
        <button
          type="button"
          onClick={handleReset}
          className="mt-6 rounded-[22px] bg-[#173E44] px-5 py-3 text-sm font-semibold text-white transition hover:bg-[#1E4E55]"
        >
          Reset saved app data and reload
        </button>
      </div>
    </div>
  );
}
