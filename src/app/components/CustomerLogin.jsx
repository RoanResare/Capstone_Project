import { useState } from "react";
import { motion } from "motion/react";
import { Link, Navigate, useLocation, useNavigate } from "react-router-dom";
import { ShieldCheck } from "lucide-react";
import { PasswordStrengthMeter } from "./PasswordStrengthMeter.jsx";
import { useAuth } from "../context/AuthContext.jsx";
import { useToast } from "../context/ToastContext.jsx";
import {
  createAccessDeniedState,
  normalizeRole,
  resolveAuthorizedPath,
} from "../utils/roleUtils.js";

export function CustomerLogin() {
  const expectedRole = "customer";
  const navigate = useNavigate();
  const location = useLocation();
  const {
    signIn,
    currentUser,
    firebaseConfigError,
    isAuthenticated,
    isLoading,
    isOnline,
  } = useAuth();
  const { error: showErrorToast } = useToast();
  const [form, setForm] = useState({ email: "", password: "" });
  const [feedback, setFeedback] = useState({ type: "", message: "" });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const requestedPath =
    typeof location.state?.from === "string" ? location.state.from.trim() : "";
  const crossRoleState =
    typeof location.state?.from === "string" && location.state.from
      ? { from: location.state.from }
      : undefined;

  if (!isLoading && isAuthenticated && currentUser) {
    const actualRole = normalizeRole(currentUser.role);

    if (actualRole !== expectedRole) {
      return (
        <Navigate
          to="/unauthorized"
          replace
          state={createAccessDeniedState({
            actualRole,
            allowedRoles: [expectedRole],
            requestedPath: "/customer/login",
          })}
        />
      );
    }

    return <Navigate to={resolveAuthorizedPath(actualRole, requestedPath)} replace />;
  }

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (isSubmitting) {
      return;
    }

    setIsSubmitting(true);
    setFeedback({ type: "", message: "" });

    try {
      const result = await signIn({
        email: form.email.trim(),
        password: form.password,
        roleHint: "customer",
      });

      if (!result.ok) {
        setFeedback({ type: "error", message: result.error });
        showErrorToast(result.error);
        return;
      }

      navigate(resolveAuthorizedPath(result.user.role, requestedPath), { replace: true });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-[calc(100vh-5rem)] bg-[#F6F0E7] px-6 py-14 lg:py-18">
      <div className="mx-auto grid max-w-[1220px] items-start gap-10 lg:grid-cols-[1.02fr_0.98fr]">
        <motion.div
          initial={{ opacity: 0, x: -24 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.55 }}
          className="rounded-[36px] bg-[linear-gradient(135deg,#173E44_0%,#2D6B73_55%,#82C8C0_100%)] p-8 text-white shadow-[0_24px_56px_rgba(20,43,46,0.2)] md:p-10"
        >
          <p className="inline-flex rounded-full border border-white/14 bg-white/10 px-4 py-2 text-xs font-semibold uppercase tracking-[0.18em] text-white/76">
            Firebase Sign In
          </p>
          <h1 className="mt-5 text-4xl font-semibold tracking-[-0.04em] md:text-[4.2rem]">
            Sign in with your customer email and password.
          </h1>
          <p className="mt-4 max-w-2xl text-base leading-7 text-white/78 md:text-lg">
            Customer accounts now authenticate directly with Firebase email and password. Username
            lookup is no longer used during sign-in, which avoids the Firestore permission issue
            that was blocking customer access.
          </p>

          <div className="mt-8 rounded-[28px] border border-white/12 bg-white/8 p-5">
            <p className="text-sm font-semibold uppercase tracking-[0.16em] text-white/64">
              Standard Firebase flow
            </p>
            <div className="mt-4 space-y-3 text-sm text-white/78">
              <p>1. Enter the email address linked to your customer account.</p>
              <p>2. Firebase Authentication validates the email and password directly.</p>
              <p>3. Your customer profile loads from Firestore after sign-in succeeds.</p>
            </div>
          </div>

          <p className="mt-8 text-sm text-white/74">
            Need a new account?{" "}
            <Link
              to="/customer/signup"
              className="font-semibold text-white underline underline-offset-4"
            >
              Create one here
            </Link>
            . Staff and admin users must use their own protected sign-in pages with email OTP.
          </p>
        </motion.div>

        <motion.section
          initial={{ opacity: 0, x: 24 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.55, delay: 0.08 }}
          className="rounded-[34px] bg-white p-8 shadow-[0_18px_40px_rgba(94,81,60,0.14)] md:p-10"
        >
          <form onSubmit={handleSubmit} className="space-y-5">
            {firebaseConfigError && (
              <div className="rounded-[22px] border border-[#FFF0CC] bg-[#FFF9EA] px-4 py-4 text-sm text-[#8A6410]">
                Firebase client setup is incomplete. Fill the `VITE_FIREBASE_*` values in the
                root `.env` to finish the customer auth setup.
              </div>
            )}
            {!isOnline && (
              <div className="rounded-[22px] border border-[#D8E8EA] bg-[#F5FAFA] px-4 py-4 text-sm text-[#48656A]">
                You are offline. Reconnect before signing in so Firebase can validate your
                password and load your profile.
              </div>
            )}
            <div>
              <label className="mb-2 block text-sm font-medium text-[#415D62]">Email</label>
              <input
                type="email"
                value={form.email}
                onChange={(event) =>
                  setForm((current) => ({ ...current, email: event.target.value }))
                }
                disabled={isSubmitting}
                className="w-full rounded-[20px] border border-[#D9E7E7] px-4 py-3 outline-none transition focus:border-[#2D9B9B]"
                placeholder="Enter your email address"
              />
            </div>

            <div>
              <label className="mb-2 block text-sm font-medium text-[#415D62]">Password</label>
              <input
                type="password"
                value={form.password}
                onChange={(event) =>
                  setForm((current) => ({ ...current, password: event.target.value }))
                }
                disabled={isSubmitting}
                className="w-full rounded-[20px] border border-[#D9E7E7] px-4 py-3 outline-none transition focus:border-[#2D9B9B]"
                placeholder="Enter your password"
              />
              <PasswordStrengthMeter password={form.password} />
            </div>

            <button
              type="submit"
              disabled={isSubmitting}
              className="inline-flex w-full items-center justify-center gap-2 rounded-[22px] bg-[#2D9B9B] px-5 py-3 text-sm font-semibold text-white transition hover:bg-[#288A8A]"
            >
              Sign in as customer
              <ShieldCheck size={16} />
            </button>

            <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
              <Link
                to="/forgot-password"
                className="font-semibold text-[#2D6B73] underline underline-offset-4"
              >
                Forgot password?
              </Link>
              <Link
                to="/customer/signup"
                state={crossRoleState}
                className="font-semibold text-[#607277] underline underline-offset-4"
              >
                Create account
              </Link>
            </div>
          </form>

          {feedback.message && (
            <p
              className={`mt-6 rounded-[22px] px-4 py-3 text-sm font-medium ${
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
