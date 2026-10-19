import { useEffect, useState } from "react";
import { readSessionStorageItem, removeSessionStorageItem } from "../utils/browserState.js";
import { motion } from "motion/react";
import { Link, Navigate, useLocation, useNavigate } from "react-router-dom";
import { Eye, EyeOff, LogIn, UserPlus, X } from "lucide-react";
import { BrandMark } from "./BrandMark.jsx";
import { useAuth } from "../context/AuthContext.jsx";
import { useToast } from "../context/ToastContext.jsx";
import { branchDetails } from "../data/systemData.js";
import { resolveAuthorizedPath, resolveHomePath } from "../utils/roleUtils.js";
import { useRememberedLogin } from "../utils/useRememberedLogin.js";
import { clearRememberedPortalLogin } from "../utils/portalRememberMe.js";
import {
  clearRememberedCustomerLogin,
  readRememberedCustomerLogin,
} from "../utils/customerRememberMe.js";

export function Login() {
  const navigate = useNavigate();
  const location = useLocation();
  const {
    beginUnifiedLogin,
    currentUser,
    firebaseConfigError,
    homePath,
    isAuthenticated,
    isLoading,
    isOnline,
  } = useAuth();
  const { error: showErrorToast, success: showSuccessToast, info: showInfoToast } = useToast();
  const [form, setForm] = useState({ identifier: "", password: "", rememberDevice: false });
  const [fieldErrors, setFieldErrors] = useState({});
  const [feedback, setFeedback] = useState(() => {
    const message = readSessionStorageItem("furfection-security-warning") || "";
    const verified = new URLSearchParams(location.search).get("emailVerified") === "1";
    return verified
      ? { type: "success", message: "Your email is verified. You can now sign in." }
      : { type: message ? "error" : "", message };
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showTerms, setShowTerms] = useState(false);
  const requestedPath = typeof location.state?.from === "string" ? location.state.from.trim() : "";
  const nextState = requestedPath ? { from: requestedPath } : undefined;

  useEffect(() => {
    const warning = readSessionStorageItem("furfection-security-warning");
    if (warning) showErrorToast(warning);
    removeSessionStorageItem("furfection-security-warning");
  }, []);

  useRememberedLogin(undefined, setForm, setFeedback, showInfoToast);

  if (!isLoading && isAuthenticated && currentUser) {
    return <Navigate to={homePath || resolveHomePath(currentUser.role)} replace />;
  }

  const updateField = (field) => (event) => {
    setForm((current) => ({ ...current, [field]: event.target.value }));
    setFeedback({ type: "", message: "" });
    setFieldErrors((current) => ({ ...current, [field]: "" }));
  };

  const validateForm = () => {
    const nextErrors = {};

    if (!form.identifier.trim()) {
      nextErrors.identifier = "Email or username is required.";
    }

    if (!form.password) {
      nextErrors.password = "Password is required.";
    }

    setFieldErrors(nextErrors);
    return Object.keys(nextErrors).length === 0;
  };

  const handleSubmit = async (event) => {
    event.preventDefault();

    if (isSubmitting || !validateForm()) {
      return;
    }

    setIsSubmitting(true);
    setFeedback({ type: "", message: "" });

    try {
      const result = await beginUnifiedLogin({
        identifier: form.identifier.trim(),
        password: form.password,
        requestedPath,
        rememberDevice: form.rememberDevice,
      });

      if (!result.ok) {
        setFeedback({ type: "error", message: result.error });
        showErrorToast(result.error);
        return;
      }

      if (result.requiresTwoFactor) {
        showSuccessToast(result.message || "Verification code sent to your email.");
        navigate(result.verificationPath || "/verify-otp", { replace: true });
        return;
      }

      navigate(resolveAuthorizedPath(result.user.role, requestedPath), { replace: true });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-[calc(100vh-5rem)] bg-[#F6F0E7] px-4 py-8 sm:px-6 lg:py-10">
      <div className="mx-auto grid max-w-[1040px] items-center gap-8 lg:min-h-[calc(100vh-8rem)] lg:grid-cols-[0.95fr_1.05fr]">
        <motion.section
          initial={{ opacity: 0, x: -18 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.45 }}
          className="rounded-lg bg-[linear-gradient(135deg,#173E44_0%,#2D6B73_62%,#7BC2BB_100%)] p-7 text-white shadow-[0_18px_42px_rgba(20,43,46,0.2)] sm:p-9"
        >
          <div className="flex items-center gap-3">
            <BrandMark className="h-14 w-14 shrink-0" />
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-white/70">
                Charming Fur-fection
              </p>
              <h1 className="text-2xl font-semibold leading-tight">
                Pet Care Services - Las Piñas City
              </h1>
            </div>
          </div>

        </motion.section>

        <motion.section
          initial={{ opacity: 0, x: 18 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.45, delay: 0.06 }}
          className="rounded-lg bg-white p-6 shadow-[0_18px_40px_rgba(94,81,60,0.14)] sm:p-8"
        >
          <div className="mb-6 text-center">
            <h2 className="text-2xl font-semibold text-[#20343B]">
              {branchDetails.name}
            </h2>
            <p className="mt-2 text-sm text-[#607277]">
              Log in with your account credentials.
            </p>
          </div>

          <form onSubmit={handleSubmit} autoComplete="off" className="space-y-4">
            {firebaseConfigError && (
              <div className="rounded-lg border border-[#FFF0CC] bg-[#FFF9EA] px-4 py-3 text-sm text-[#8A6410]">
                Firebase setup is incomplete. Fill the required environment values to enable login.
              </div>
            )}
            {!isOnline && (
              <div className="rounded-lg border border-[#D8E8EA] bg-[#F5FAFA] px-4 py-3 text-sm text-[#48656A]">
                You are offline. Reconnect before signing in.
              </div>
            )}

            <div>
              <label className="mb-2 block text-sm font-medium text-[#415D62]">
                Email / Username
              </label>
              <input
                value={form.identifier}
                autoComplete="off"
                onChange={updateField("identifier")}
                disabled={isSubmitting}
                className={`w-full rounded-lg border px-4 py-3 outline-none transition focus:border-[#2D9B9B] ${
                  fieldErrors.identifier ? "border-[#D95A6A]" : "border-[#D9E7E7]"
                }`}
                placeholder="Enter your email or username"
              />
              {fieldErrors.identifier && (
                <p className="mt-2 text-sm text-[#B23949]">{fieldErrors.identifier}</p>
              )}
            </div>

            <div>
              <label className="mb-2 block text-sm font-medium text-[#415D62]">Password</label>
              <div className="relative">
                <input
                  type={showPassword ? "text" : "password"}
                  value={form.password}
                  autoComplete="new-password"
                  onChange={updateField("password")}
                  disabled={isSubmitting}
                  className={`w-full rounded-lg border px-4 py-3 pr-11 outline-none transition focus:border-[#2D9B9B] ${
                    fieldErrors.password ? "border-[#D95A6A]" : "border-[#D9E7E7]"
                  }`}
                  placeholder="Enter your password"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((visible) => !visible)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-[#607277]"
                  aria-label={showPassword ? "Hide password" : "Show password"}
                >
                  {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
              {fieldErrors.password && (
                <p className="mt-2 text-sm text-[#B23949]">{fieldErrors.password}</p>
              )}
            </div>

            <button
              type="submit"
              disabled={isSubmitting}
              className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-[#2D9B9B] px-5 py-3 text-sm font-semibold text-white transition hover:bg-[#288A8A] disabled:cursor-not-allowed disabled:opacity-70"
            >
              {isSubmitting ? "Logging in..." : "Log In"}
              <LogIn size={16} />
            </button>

            <div className="flex flex-wrap items-center justify-between gap-3">
            <label className="flex items-start gap-3 text-sm font-semibold text-[#415D62]">
              <span>Remember me</span>
              <input
                type="checkbox"
                checked={form.rememberDevice}
                onChange={(event) => {
                  const checked = event.target.checked;
                  if (!checked) {
                    clearRememberedPortalLogin();
                    const remembered = readRememberedCustomerLogin();
                    clearRememberedCustomerLogin();
                    setForm((current) => ({
                      ...current,
                      password:
                        remembered.status === "active" &&
                        current.identifier.trim() === remembered.credentials.identifier &&
                        current.password === remembered.credentials.password
                          ? ""
                          : current.password,
                      rememberDevice: false,
                    }));
                    return;
                  }
                  setForm((current) => ({ ...current, rememberDevice: checked }));
                }}
                disabled={isSubmitting}
                className="mt-1 h-4 w-4 accent-[#2D9B9B]"
              />
            </label>
            <button type="button" onClick={() => setShowTerms(true)} className="text-sm font-semibold text-[#2D6B73] underline underline-offset-4">
              Terms and Conditions
            </button>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 pt-1 text-sm">
              <Link
                to="/customer/signup"
                state={nextState}
                className="font-semibold text-[#2D6B73] underline underline-offset-4"
              >
                Create Account
              </Link>
              <Link
                to="/forgot-password"
                className="font-semibold text-[#607277] underline underline-offset-4"
              >
                Forgot Password?
              </Link>
            </div>
          </form>

          {feedback.message && (
            <p
              className={`mt-5 rounded-lg px-4 py-3 text-sm font-medium ${
                feedback.type === "error"
                  ? "bg-[#FBECEF] text-[#B23949]"
                  : "bg-[#EAF7F7] text-[#2D6B73]"
              }`}
            >
              {feedback.message}
            </p>
          )}
        </motion.section>
      </div>
      {showTerms && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#102D32]/60 p-4" onMouseDown={(event) => { if (event.target === event.currentTarget) setShowTerms(false); }}>
          <section role="dialog" aria-modal="true" aria-labelledby="login-terms-title" className="w-full max-w-lg rounded-3xl bg-white p-6 shadow-2xl sm:p-8">
            <div className="flex items-start justify-between gap-4">
              <h2 id="login-terms-title" className="text-xl font-semibold text-[#20343B]">Terms and Conditions</h2>
              <button type="button" onClick={() => setShowTerms(false)} aria-label="Close terms and conditions" className="rounded-full p-2 text-[#607277] hover:bg-[#F1F7F7]"><X size={20} /></button>
            </div>
            <div className="mt-4 max-h-[60vh] overflow-y-auto pr-2 text-sm leading-6 text-[#607277]">
              <p>Use accurate account information and keep your password private. You are responsible for activity under your account and should sign in only on devices you trust.</p>
              <p className="mt-3">Use the service to book appointments for pets under your care. Provide accurate health and contact details so clinic staff can coordinate care and appointment updates.</p>
              <p className="mt-3">Contact details and submitted pet notes or photos may be used for appointment coordination, account security, reminders, and clinic notices. Authorized clinic staff may review information relevant to your pet's care.</p>
              <p className="mt-3">Do not attempt to access another person's account or disrupt the service. The clinic may restrict accounts involved in misuse or security concerns.</p>
            </div>
            <button type="button" onClick={() => setShowTerms(false)} className="mt-6 w-full rounded-xl bg-[#2D9B9B] px-5 py-3 text-sm font-semibold text-white">Close</button>
          </section>
        </div>
      )}
    </div>
  );
}
