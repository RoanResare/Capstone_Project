import { useEffect, useMemo, useState } from "react";
import { motion } from "motion/react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Eye, EyeOff } from "lucide-react";
import { useAuth } from "../context/AuthContext.jsx";
import { useToast } from "../context/ToastContext.jsx";
import { getPasswordPolicyError } from "../utils/passwordPolicy.js";

const passwordChecklist = [
  "At least 6 characters",
  "At least one uppercase and one lowercase letter",
  "At least one special character or symbol",
];

export function ResetPassword() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { completePasswordReset, isOnline, validatePasswordResetCode } = useAuth();
  const { error: showErrorToast, success: showSuccessToast } = useToast();
  const [form, setForm] = useState({
    oobCode: searchParams.get("oobCode") || searchParams.get("token") || "",
    newPassword: "",
    confirmPassword: "",
  });
  const [feedback, setFeedback] = useState({ type: "", message: "" });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isCheckingCode, setIsCheckingCode] = useState(Boolean(form.oobCode.trim()));
  const [verifiedEmail, setVerifiedEmail] = useState("");
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const hasCode = useMemo(() => Boolean(form.oobCode.trim()), [form.oobCode]);
  const passwordsMatch =
    Boolean(form.newPassword && form.confirmPassword) && form.newPassword === form.confirmPassword;

  useEffect(() => {
    let active = true;

    async function verifyCode() {
      if (!form.oobCode.trim() || form.oobCode.trim().length < 6) {
        setVerifiedEmail("");
        setIsCheckingCode(false);
        return;
      }

      setIsCheckingCode(true);
      const result = await validatePasswordResetCode(form.oobCode.trim());

      if (!active) {
        return;
      }

      if (!result.ok) {
        setVerifiedEmail("");
        setFeedback({ type: "error", message: result.error });
      } else {
        setVerifiedEmail(result.email || "");
        setFeedback({ type: "", message: "" });
      }

      setIsCheckingCode(false);
    }

    verifyCode();

    return () => {
      active = false;
    };
  }, [form.oobCode]);

  const handleSubmit = async (event) => {
    event.preventDefault();

    if (isSubmitting) {
      return;
    }

    const passwordError = getPasswordPolicyError(form.newPassword);
    if (passwordError) {
      setFeedback({ type: "error", message: passwordError });
      showErrorToast(passwordError);
      return;
    }

    if (form.newPassword !== form.confirmPassword) {
      const message = "New password and confirmation password must match.";
      setFeedback({ type: "error", message });
      showErrorToast(message);
      return;
    }

    setIsSubmitting(true);
    setFeedback({ type: "", message: "" });

    try {
      const result = await completePasswordReset({
        oobCode: form.oobCode.trim(),
        newPassword: form.newPassword,
        confirmPassword: form.confirmPassword,
      });

      if (!result.ok) {
        setFeedback({ type: "error", message: result.error });
        showErrorToast(result.error);
        return;
      }

      setFeedback({ type: "success", message: result.message });
      showSuccessToast(result.message);
      window.setTimeout(() => {
        navigate("/login", { replace: true });
      }, 1200);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-[calc(100vh-5rem)] bg-[#F6F0E7] px-6 py-14 lg:py-18">
      <div className="mx-auto grid max-w-[1120px] items-start gap-10 lg:grid-cols-[1fr_0.92fr]">
        <motion.section
          initial={{ opacity: 0, x: -24 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.55 }}
          className="rounded-[36px] bg-[linear-gradient(135deg,#173E44_0%,#2D6B73_58%,#82C8C0_100%)] p-8 text-white shadow-[0_24px_56px_rgba(20,43,46,0.2)] md:p-10"
        >
          <p className="inline-flex rounded-full border border-white/14 bg-white/10 px-4 py-2 text-xs font-semibold uppercase tracking-[0.18em] text-white/76">
            Reset Password
          </p>
          <h1 className="mt-5 text-4xl font-semibold tracking-[-0.04em] md:text-[4.1rem]">
            Choose a new password for your account.
          </h1>
          <p className="mt-4 max-w-2xl text-base leading-7 text-white/78 md:text-lg">
            Open the reset link from your email. If the Firebase verification code is still valid,
            you can set a new password here and then sign in again normally.
          </p>

          <div className="mt-8 rounded-[28px] border border-white/12 bg-white/8 p-5">
            <p className="text-sm font-semibold uppercase tracking-[0.16em] text-white/64">
              Password requirements
            </p>
            <div className="mt-4 space-y-3 text-sm text-white/78">
              {passwordChecklist.map((rule) => (
                <p key={rule}>{rule}</p>
              ))}
            </div>
          </div>
        </motion.section>

        <motion.section
          initial={{ opacity: 0, x: 24 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.55, delay: 0.08 }}
          className="rounded-[34px] bg-white p-8 shadow-[0_18px_40px_rgba(94,81,60,0.14)] md:p-10"
        >
          <form onSubmit={handleSubmit} className="space-y-5">
            <input type="hidden" name="oobCode" value={form.oobCode} readOnly />

            {!isOnline && (
              <div className="rounded-[22px] border border-[#D8E8EA] bg-[#F5FAFA] px-4 py-4 text-sm text-[#48656A]">
                You are offline. Reconnect before verifying the reset code and saving a new
                password.
              </div>
            )}

            <div>
              <label className="mb-2 block text-sm font-medium text-[#415D62]">New password</label>
              <div className="relative">
                <input
                  type={showNewPassword ? "text" : "password"}
                  value={form.newPassword}
                  autoComplete="new-password"
                  onChange={(event) =>
                    setForm((current) => ({ ...current, newPassword: event.target.value }))
                  }
                  disabled={isSubmitting}
                  className="w-full rounded-[20px] border border-[#D9E7E7] px-4 py-3 pr-12 outline-none transition focus:border-[#2D9B9B]"
                  placeholder="Enter your new password"
                />
                <button
                  type="button"
                  onClick={() => setShowNewPassword((visible) => !visible)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-[#607277]"
                  aria-label={showNewPassword ? "Hide new password" : "Show new password"}
                >
                  {showNewPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
            </div>

            <div>
              <label className="mb-2 block text-sm font-medium text-[#415D62]">
                Confirm password
              </label>
              <div className="relative">
                <input
                  type={showConfirmPassword ? "text" : "password"}
                  value={form.confirmPassword}
                  autoComplete="new-password"
                  onChange={(event) =>
                    setForm((current) => ({ ...current, confirmPassword: event.target.value }))
                  }
                  disabled={isSubmitting}
                  className="w-full rounded-[20px] border border-[#D9E7E7] px-4 py-3 pr-12 outline-none transition focus:border-[#2D9B9B]"
                  placeholder="Re-enter your new password"
                />
                <button
                  type="button"
                  onClick={() => setShowConfirmPassword((visible) => !visible)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-[#607277]"
                  aria-label={showConfirmPassword ? "Hide confirmation password" : "Show confirmation password"}
                >
                  {showConfirmPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
              {form.confirmPassword && !passwordsMatch && (
                <p className="mt-2 text-xs text-[#B23949]">Passwords do not match.</p>
              )}
            </div>

            <button
              type="submit"
              disabled={
                isSubmitting ||
                isCheckingCode ||
                !hasCode ||
                !verifiedEmail ||
                !passwordsMatch
              }
              className="w-full rounded-[22px] bg-[#173E44] px-5 py-3 text-sm font-semibold text-white transition hover:bg-[#1F4E55] disabled:cursor-not-allowed disabled:opacity-70"
            >
              {isSubmitting ? "Resetting password..." : "Reset password"}
            </button>

            <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
              <Link
                to="/forgot-password"
                className="font-semibold text-[#2D6B73] underline underline-offset-4"
              >
                Request a new reset link
              </Link>
              <Link
                to="/login"
                className="font-semibold text-[#607277] underline underline-offset-4"
              >
                Return to login
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
