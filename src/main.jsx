import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { resetAllBrowserState } from "./app/utils/browserState.js";
import "./styles/index.css";

function describeError(error) {
  if (error instanceof Error) {
    return error.message || error.name || "Unknown startup error.";
  }

  if (typeof error === "string") {
    return error;
  }

  return "Unknown startup error.";
}

function clearStartupStorage() {
  try {
    resetAllBrowserState();
  } catch (error) {
    console.error("Unable to clear browser storage during startup recovery.", error);
  }
}

function StartupFallback({ detail }) {
  return (
    <div className="min-h-screen bg-[#F6F0E7] px-6 py-12 text-[#20343B]">
      <div className="mx-auto max-w-3xl rounded-[32px] bg-white p-8 shadow-[0_20px_42px_rgba(94,81,60,0.12)]">
        <p className="text-sm font-semibold uppercase tracking-[0.18em] text-[#7B9A9F]">
          Startup Recovery
        </p>
        <h1 className="mt-3 text-3xl font-semibold">
          The app failed before React could finish loading the page.
        </h1>
        <p className="mt-4 text-base leading-7 text-[#607277]">
          This usually means a route module, saved browser data, or early startup effect crashed
          during boot. Resetting the browser state will reload the latest interface cleanly.
        </p>
        <div className="mt-6 rounded-[24px] bg-[#F8FBFB] px-5 py-4 text-sm text-[#4C6368]">
          {describeError(detail)}
        </div>
        <button
          type="button"
          onClick={() => {
            clearStartupStorage();
            window.location.reload();
          }}
          className="mt-6 rounded-[22px] bg-[#173E44] px-5 py-3 text-sm font-semibold text-white transition hover:bg-[#1E4E55]"
        >
          Reset saved app data and reload
        </button>
      </div>
    </div>
  );
}

const rootElement = document.getElementById("root");
const root = createRoot(rootElement);

function renderStartupFallback(error) {
  root.render(<StartupFallback detail={error} />);
}

function installBootGuards() {
  const handleError = (event) => {
    renderStartupFallback(event.error || event.message);
  };
  const handleRejection = (event) => {
    renderStartupFallback(event.reason);
  };

  window.addEventListener("error", handleError);
  window.addEventListener("unhandledrejection", handleRejection);

  return () => {
    window.removeEventListener("error", handleError);
    window.removeEventListener("unhandledrejection", handleRejection);
  };
}

async function bootApp() {
  const removeBootGuards = installBootGuards();

  try {
    const [{ default: App }, { AppErrorBoundary }] = await Promise.all([
      import("./app/App.jsx"),
      import("./app/components/AppErrorBoundary.jsx"),
    ]);

    root.render(
      <StrictMode>
        <AppErrorBoundary>
          <App />
        </AppErrorBoundary>
      </StrictMode>,
    );

    window.setTimeout(removeBootGuards, 3000);
  } catch (error) {
    removeBootGuards();
    renderStartupFallback(error);
  }
}

bootApp();
