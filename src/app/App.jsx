import { useEffect, useRef } from "react";
import { RouterProvider } from "react-router-dom";
import { router } from "./routes.jsx";
import { AppProvider } from "./context/AppContext.jsx";
import { AuthProvider } from "./context/AuthContext.jsx";
import { ToastProvider } from "./context/ToastContext.jsx";
import { useAuth } from "./context/AuthContext.jsx";
import { useToast } from "./context/ToastContext.jsx";

const INACTIVITY_LIMIT_MS = 30 * 60 * 1000;
const INACTIVITY_WARNING_MS = INACTIVITY_LIMIT_MS - 30 * 1000;

function InactivityGuard() {
  const { currentUser, signOut } = useAuth();
  const toast = useToast();
  const signOutRef = useRef(signOut);
  const toastRef = useRef(toast);
  signOutRef.current = signOut;
  toastRef.current = toast;

  useEffect(() => {
    if (!currentUser || !["admin", "staff"].includes(currentUser.role)) {
      return undefined;
    }

    let warningTimer;
    let logoutTimer;
    let warned = false;

    const clearTimers = () => {
      window.clearTimeout(warningTimer);
      window.clearTimeout(logoutTimer);
    };

    const schedule = () => {
      clearTimers();
      warned = false;
      warningTimer = window.setTimeout(() => {
        warned = true;
        toastRef.current.info("You will be signed out in 30 seconds because of inactivity.");
      }, INACTIVITY_WARNING_MS);
      logoutTimer = window.setTimeout(async () => {
        if (warned) {
          toastRef.current.info("Your session ended after 30 minutes of inactivity.");
        }
        await signOutRef.current();
      }, INACTIVITY_LIMIT_MS);
    };

    const activityEvents = ["pointerdown", "keydown", "scroll", "touchstart"];
    activityEvents.forEach((eventName) => window.addEventListener(eventName, schedule, { passive: true }));
    schedule();

    return () => {
      clearTimers();
      activityEvents.forEach((eventName) => window.removeEventListener(eventName, schedule));
    };
  }, [currentUser?.uid]);

  return null;
}

export default function App() {
  return (
    <AuthProvider>
      <AppProvider>
        <ToastProvider>
          <InactivityGuard />
          <RouterProvider router={router} />
        </ToastProvider>
      </AppProvider>
    </AuthProvider>
  );
}
