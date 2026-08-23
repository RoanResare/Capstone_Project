import { useState } from "react";
import { motion } from "motion/react";
import { Link, Navigate, useLocation, useNavigate } from "react-router-dom";
import { LockKeyhole, ShieldCheck } from "lucide-react";
import { useAuth } from "../context/AuthContext.jsx";
import { useToast } from "../context/ToastContext.jsx";
import {
  createAccessDeniedState,
  normalizeRole,
  resolveAuthorizedPath,
} from "../utils/roleUtils.js";

function supportLinks(role) {
  if (role === "admin") {
    return {
      alternateLabel: "Staff login",
      alternatePath: "/staff/login",
    };
  }

  return {
    alternateLabel: "Admin login",
    alternatePath: "/admin/login",
  };
}

export function RoleLoginPage({
  role,
  eyebrow,
  title,
  description,
  submitLabel,
  loginPath,
}) {
  const navigate = useNavigate();
  const location = useLocation();
  const {
    beginLogin,
    currentUser,
    firebaseConfigError,
    isAuthenticated,
    isLoading,
    isOnline,
  } = useAuth();
  const { error: showErrorToast, success: showSuccessToast } = useToast();
  const [form, setForm] = useState({ identifier: "", password: "" });
  const [feedback, setFeedback] = useState({ type: "", message: "" });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const links = supportLinks(role);
  const expectedRole = normalizeRole(role);
  const requestedPath = typeof location.state?.from === "string" ? location.state.from.trim() : "";

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
            requestedPath: loginPath,
          })}
        />
      );
    }

    return <Navigate to={resolveAuthorizedPath(actualRole, requestedPath)} replace />;
  }
  const crossRoleState =
    typeof location.state?.from === "string" && location.state.from
      ? { from: location.state.from }
      : undefined;

  const handleSubmit = async (event) => {
    event.preventDefault();

    if (isSubmitting) {
      return;
    }

    setIsSubmitting(true);
    setFeedback({ type: "", message: "" });

    try {
      const result = await beginLogin({
        identifier: form.identifier.trim(),
        password: form.password,
        requestedPath,
        role,
      });

      if (!result.ok) {
        setFeedback({ type: "error", message: result.error });
        showErrorToast(result.error);
        return;
      }

      if (result.requiresTwoFactor) {
        showSuccessToast(result.message || "Verification code sent to your email.");
        navigate(result.verificationPath || "/verify-otp", {
          replace: true,
        });
        return;
      }

      navigate(resolveAuthorizedPath(result.user.role, requestedPath), {
        replace: true,
      });
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
          className="rounded-[36px] bg-[linear-gradient(135deg,#173E44_0%,#2D6B73_58%,#82C8C0_100%)] p-8 text-white shadow-[0_24px_56px_rgba(20,43,46,0.2)] md:p-10"
        >
          <p className="inline-flex rounded-full border border-white/14 bg-white/10 px-4 py-2 text-xs font-semibold uppercase tracking-[0.18em] text-white/76">
            {eyebrow}
          </p>
          <h1 className="mt-5 text-4xl font-semibold tracking-[-0.04em] md:text-[4.2rem]">
            {title}
          </h1>
          <p className="mt-4 max-w-2xl text-base leading-7 text-white/78 md:text-lg">
            {description}
          </p>

          <div className="mt-8 rounded-[28px] border border-white/12 bg-white/8 p-5">
            <p className="text-sm font-semibold uppercase tracking-[0.16em] text-white/64">
              Protected portal flow
            </p>
            <div className="mt-4 space-y-3 text-sm text-white/78">
              <p>1. Credentials are validated against Firebase Authentication on the server.</p>
              <p>
                2. Admin and staff accounts must complete an emailed OTP before any portal route
                opens.
              </p>
              <p>3. Protected portal APIs accept only the verified post-OTP session token.</p>
            </div>
          </div>

          <p className="mt-8 text-sm text-white/74">
            Need a different account?{" "}
            <Link
              to={links.alternatePath}
              state={crossRoleState}
              className="font-semibold text-white underline underline-offset-4"
            >
              {links.alternateLabel}
            </Link>{" "}
            or{" "}
            <Link
              to="/customer/login"
              state={crossRoleState}
              className="font-semibold text-white underline underline-offset-4"
            >
              customer login
            </Link>
            .
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
                Firebase client setup is incomplete. The public site will still load, but complete
                the `VITE_FIREBASE_*` values in the root `.env` for full login token sync.
              </div>
            )}
            {!isOnline && (
              <div className="rounded-[22px] border border-[#D8E8EA] bg-[#F5FAFA] px-4 py-4 text-sm text-[#48656A]">
                You are offline. Reconnect before signing in so Firebase can validate your
                password and restore the correct role-based dashboard.
              </div>
            )}

            <div className="rounded-[24px] bg-[#F5FAFA] px-5 py-5">
              <div className="flex items-start gap-3">
                <div className="mt-0.5 flex h-10 w-10 items-center justify-center rounded-full bg-[#EEF6F6] text-[#2D6B73]">
                  <LockKeyhole size={18} />
                </div>
                <div>
                  <p className="text-sm font-semibold uppercase tracking-[0.16em] text-[#7A979C]">
                    Username/email + OTP
                  </p>
                  <p className="mt-2 text-sm leading-6 text-[#607277]">
                    Use the username or email registered to your portal account. The server checks
                    the saved Firestore role first, then sends a one-time password before the
                    protected dashboard opens.
                  </p>
                </div>
              </div>
            </div>

            <div>
              <label className="mb-2 block text-sm font-medium text-[#415D62]">
                Username or email
              </label>
              <input
                value={form.identifier}
                onChange={(event) =>
                  setForm((current) => ({ ...current, identifier: event.target.value }))
                }
                disabled={isSubmitting}
                className="w-full rounded-[20px] border border-[#D9E7E7] px-4 py-3 outline-none transition focus:border-[#2D9B9B]"
                placeholder="Enter your username or email"
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
            </div>

            <button
              type="submit"
              disabled={isSubmitting}
              className="inline-flex w-full items-center justify-center gap-2 rounded-[22px] bg-[#173E44] px-5 py-3 text-sm font-semibold text-white transition hover:bg-[#1F4E55]"
            >
              {submitLabel}
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
                to="/login"
                state={crossRoleState}
                className="font-semibold text-[#607277] underline underline-offset-4"
              >
                View all login options
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
