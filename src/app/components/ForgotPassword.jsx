import { useState } from "react";
import { motion } from "motion/react";
import { Link } from "react-router-dom";
import { Mail } from "lucide-react";
import { useAuth } from "../context/AuthContext.jsx";
import { useToast } from "../context/ToastContext.jsx";

export function ForgotPassword() {
  const { isOnline, requestPasswordReset } = useAuth();
  const { error: showErrorToast, success: showSuccessToast } = useToast();
  const [email, setEmail] = useState("");
  const [feedback, setFeedback] = useState({ type: "", message: "" });
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (event) => {
    event.preventDefault();

    if (isSubmitting) {
      return;
    }

    setIsSubmitting(true);
    setFeedback({ type: "", message: "" });

    try {
      const result = await requestPasswordReset(email.trim());
      setFeedback({
        type: result.ok ? "success" : "error",
        message: result.ok ? result.message : result.error,
      });
      if (result.ok) {
        showSuccessToast(result.message);
      } else {
        showErrorToast(result.error);
      }
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
            Password Recovery
          </p>
          <h1 className="mt-5 text-4xl font-semibold tracking-[-0.04em] md:text-[4.1rem]">
            Request a secure password reset link.
          </h1>
          <p className="mt-4 max-w-2xl text-base leading-7 text-white/78 md:text-lg">
            Enter the email address used for sign-in. The backend now generates the Firebase reset
            code and delivers a direct link to this app, so delivery and reset handling stay under
            one flow.
          </p>

          <div className="mt-8 rounded-[28px] border border-white/12 bg-white/8 p-5">
            <p className="text-sm font-semibold uppercase tracking-[0.16em] text-white/64">
              Reset rules
            </p>
            <div className="mt-4 space-y-3 text-sm text-white/78">
              <p>1. The server generates a Firebase password reset code.</p>
              <p>2. The email links directly to the React reset screen.</p>
              <p>3. Expired or reused reset codes are rejected automatically by Firebase.</p>
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
            <div className="rounded-[24px] bg-[#F5FAFA] px-5 py-5">
              <div className="flex items-start gap-3">
                <div className="mt-0.5 flex h-10 w-10 items-center justify-center rounded-full bg-[#EEF6F6] text-[#2D6B73]">
                  <Mail size={18} />
                </div>
                <div>
                  <p className="text-sm font-semibold uppercase tracking-[0.16em] text-[#7A979C]">
                    Email recovery
                  </p>
                  <p className="mt-2 text-sm leading-6 text-[#607277]">
                    Use the same address you sign in with. Reset delivery now runs through the
                    backend mailer, which means delivery logs, app-specific reset URLs, and
                    clearer server-side diagnostics are available.
                  </p>
                </div>
              </div>
            </div>

            {!isOnline && (
              <div className="rounded-[22px] border border-[#D8E8EA] bg-[#F5FAFA] px-4 py-4 text-sm text-[#48656A]">
                You are offline. Reconnect before requesting a password reset email.
              </div>
            )}

            <div>
              <label className="mb-2 block text-sm font-medium text-[#415D62]">Email</label>
              <input
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                disabled={isSubmitting}
                className="w-full rounded-[20px] border border-[#D9E7E7] px-4 py-3 outline-none transition focus:border-[#2D9B9B]"
                placeholder="Enter your account email"
              />
            </div>

            <button
              type="submit"
              disabled={isSubmitting}
              className="w-full rounded-[22px] bg-[#173E44] px-5 py-3 text-sm font-semibold text-white transition hover:bg-[#1F4E55]"
            >
              {isSubmitting ? "Sending reset link..." : "Send password reset link"}
            </button>

            <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
              <Link
                to="/customer/login"
                className="font-semibold text-[#2D6B73] underline underline-offset-4"
              >
                Customer login
              </Link>
              <Link
                to="/login"
                className="font-semibold text-[#607277] underline underline-offset-4"
              >
                All login options
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
