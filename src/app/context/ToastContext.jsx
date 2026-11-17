import { createContext, useContext, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { AlertCircle, CheckCircle2, Info } from "lucide-react";

const ToastContext = createContext(null);
let nextToastId = 0;

function toastStyles(type = "info") {
  if (type === "success") {
    return {
      accent: "bg-[#EAF7F7] text-[#1E6660]",
      icon: <CheckCircle2 size={18} />,
      iconWrap: "bg-[#D6F1ED] text-[#1E6660]",
    };
  }

  if (type === "error") {
    return {
      accent: "bg-[#FBECEF] text-[#B23949]",
      icon: <AlertCircle size={18} />,
      iconWrap: "bg-[#F8DCE2] text-[#B23949]",
    };
  }

  return {
    accent: "bg-[#EEF6F6] text-[#365F66]",
    icon: <Info size={18} />,
    iconWrap: "bg-[#DCEBEC] text-[#365F66]",
  };
}

function ToastViewport({ toasts, dismissToast }) {
  return (
    <div className="pointer-events-none fixed right-4 top-4 z-[90] flex w-[min(calc(100vw-2rem),24rem)] flex-col gap-3">
      <AnimatePresence initial={false}>
        {toasts.map((toast) => {
          const styles = toastStyles(toast.type);

          return (
            <motion.div
              key={toast.id}
              initial={{ opacity: 0, x: 18, y: -8 }}
              animate={{ opacity: 1, x: 0, y: 0 }}
              exit={{ opacity: 0, x: 18, y: -8 }}
              transition={{ duration: 0.2 }}
              className={`pointer-events-auto rounded-[24px] px-4 py-4 shadow-[0_18px_40px_rgba(28,48,53,0.16)] ${styles.accent}`}
            >
              <div className="flex items-start gap-3">
                <div
                  className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${styles.iconWrap}`}
                >
                  {styles.icon}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold uppercase tracking-[0.14em]">
                    {toast.type === "error"
                      ? "Action failed"
                      : toast.type === "success"
                        ? "Success"
                        : "Notice"}
                  </p>
                  <p className="mt-1 text-sm leading-6">{toast.message}</p>
                </div>
                <button
                  type="button"
                  onClick={() => dismissToast(toast.id)}
                  className="text-xs font-semibold uppercase tracking-[0.12em] opacity-70 transition hover:opacity-100"
                >
                  Close
                </button>
              </div>
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);

  function dismissToast(id) {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }

  function showToast({ message, type = "info", duration = 4200 }) {
    if (!message) {
      return null;
    }

    const toastId = `toast-${nextToastId += 1}`;
    setToasts((current) => [...current, { id: toastId, message, type }]);

    if (duration > 0 && typeof window !== "undefined") {
      window.setTimeout(() => {
        dismissToast(toastId);
      }, duration);
    }

    return toastId;
  }

  const value = {
    error(message, options = {}) {
      return showToast({ ...options, message, type: "error" });
    },
    info(message, options = {}) {
      return showToast({ ...options, message, type: "info" });
    },
    showToast,
    success(message, options = {}) {
      return showToast({ ...options, message, type: "success" });
    },
  };

  return (
    <ToastContext.Provider value={value}>
      {children}
      <ToastViewport toasts={toasts} dismissToast={dismissToast} />
    </ToastContext.Provider>
  );
}

export function useToast() {
  const context = useContext(ToastContext);

  if (!context) {
    throw new Error("useToast must be used within ToastProvider");
  }

  return context;
}
