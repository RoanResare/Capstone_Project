import { useState } from "react";
import { motion } from "motion/react";
import { Link, Navigate, useLocation, useNavigate } from "react-router-dom";
import { LogIn, ShieldCheck, UserPlus } from "lucide-react";
import { BrandMark } from "./BrandMark.jsx";
import { PasswordStrengthMeter } from "./PasswordStrengthMeter.jsx";
import { useAuth } from "../context/AuthContext.jsx";
import { useToast } from "../context/ToastContext.jsx";
import { resolveAuthorizedPath, resolveHomePath } from "../utils/roleUtils.js";

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
  const { error: showErrorToast, success: showSuccessToast } = useToast();
  const [form, setForm] = useState({ identifier: "", password: "" });
  const [fieldErrors, setFieldErrors] = useState({});
  const [feedback, setFeedback] = useState({ type: "", message: "" });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const requestedPath = typeof location.state?.from === "string" ? location.state.from.trim() : "";
  const nextState = requestedPath ? { from: requestedPath } : undefined;

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
                Pet Care Services
              </h1>
            </div>
          </div>

          <h2 className="mt-8 text-4xl font-semibold leading-tight sm:text-5xl">
            One login for customers, staff, and admins.
          </h2>
          <p className="mt-4 max-w-xl text-sm leading-7 text-white/78 sm:text-base">
            Enter your email or username and password once. The system authenticates the account,
            detects the saved role, and sends each user to the correct existing dashboard.
          </p>

          <div className="mt-7 grid gap-3 text-sm text-white/80">
            <div className="flex items-center gap-3 rounded-lg border border-white/12 bg-white/8 px-4 py-3">
              <ShieldCheck size={18} />
              Customer, Staff, and Admin dashboards remain separate.
            </div>
            <div className="flex items-center gap-3 rounded-lg border border-white/12 bg-white/8 px-4 py-3">
              <UserPlus size={18} />
              New customers can still create an account.
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
              Charming Fur-fection Pet Care Services
            </h2>
            <p className="mt-2 text-sm text-[#607277]">
              Log in with your account credentials.
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
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
              <input
                type="password"
                value={form.password}
                onChange={updateField("password")}
                disabled={isSubmitting}
                className={`w-full rounded-lg border px-4 py-3 outline-none transition focus:border-[#2D9B9B] ${
                  fieldErrors.password ? "border-[#D95A6A]" : "border-[#D9E7E7]"
                }`}
                placeholder="Enter your password"
              />
              <PasswordStrengthMeter password={form.password} />
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
    </div>
  );
}
