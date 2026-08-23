import { useEffect, useMemo, useState } from "react";
import { motion } from "motion/react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { Mail, ShieldCheck } from "lucide-react";
import { useAuth } from "../context/AuthContext.jsx";
import { useToast } from "../context/ToastContext.jsx";
import { resolveAuthorizedPath } from "../utils/roleUtils.js";

function formatCountdown(totalSeconds) {
  const safeSeconds = Math.max(0, totalSeconds);
  const minutes = Math.floor(safeSeconds / 60);
  const seconds = safeSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function parseTimestamp(value = "") {
  const timestamp = typeof value === "string" ? value.trim() : "";

  if (!timestamp) {
    return 0;
  }

  const parsed = new Date(timestamp);
  return Number.isNaN(parsed.getTime()) ? 0 : parsed.getTime();
}

export function OtpVerification() {
  const navigate = useNavigate();
  const {
    clearPendingOtp,
    currentUser,
    homePath,
    isAuthenticated,
    isOnline,
    pendingOtp,
    resendOtp,
    verifyPendingOtp,
  } = useAuth();
  const { error: showErrorToast, success: showSuccessToast } = useToast();
  const [otpCode, setOtpCode] = useState("");
  const [feedback, setFeedback] = useState({ type: "", message: "" });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isResending, setIsResending] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => {
      setNow(Date.now());
    }, 1000);

    return () => {
      window.clearInterval(timer);
    };
  }, []);

  const otpExpiresAt = useMemo(() => parseTimestamp(pendingOtp?.otpExpiresAt), [pendingOtp]);
  const resendAvailableAt = useMemo(
    () => parseTimestamp(pendingOtp?.resendAvailableAt),
    [pendingOtp],
  );
  const expiresInSeconds = otpExpiresAt ? Math.max(0, Math.ceil((otpExpiresAt - now) / 1000)) : 0;
  const resendInSeconds = resendAvailableAt
    ? Math.max(0, Math.ceil((resendAvailableAt - now) / 1000))
    : 0;
  const isOtpExpired = Boolean(pendingOtp) && expiresInSeconds <= 0;

  if (isAuthenticated && currentUser) {
    return <Navigate to={homePath || resolveAuthorizedPath(currentUser.role)} replace />;
  }

  const handleVerify = async (event) => {
    event.preventDefault();

    if (isSubmitting || isOtpExpired) {
      return;
    }

    setIsSubmitting(true);
    setFeedback({ type: "", message: "" });

    try {
      const result = await verifyPendingOtp(otpCode);

      if (!result.ok) {
        setFeedback({ type: "error", message: result.error });
        showErrorToast(result.error);
        return;
      }

      showSuccessToast("OTP verified successfully.");
      navigate(resolveAuthorizedPath(result.user.role, result.requestedPath), {
        replace: true,
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleResend = async () => {
    if (isResending || resendInSeconds > 0) {
      return;
    }

    setIsResending(true);
    setFeedback({ type: "", message: "" });

    try {
      const result = await resendOtp();
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
      setIsResending(false);
    }
  };

  if (!pendingOtp) {
    return (
      <div className="min-h-[calc(100vh-5rem)] bg-[#F6F0E7] px-6 py-14 lg:py-18">
        <div className="mx-auto max-w-[920px]">
          <motion.section
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.45 }}
            className="rounded-[36px] bg-white p-8 shadow-[0_18px_40px_rgba(94,81,60,0.14)] md:p-10"
          >
            <p className="text-sm font-semibold uppercase tracking-[0.18em] text-[#7B9A9F]">
              Verification Required
            </p>
            <h1 className="mt-3 text-4xl font-semibold tracking-[-0.04em] text-[#20343B]">
              There is no active OTP challenge.
            </h1>
            <p className="mt-4 text-base leading-7 text-[#607277] md:text-lg">
              Start a new admin or staff sign-in first, then return here after the server issues a
              verification code.
            </p>

            <div className="mt-8 flex flex-wrap gap-3">
              <Link
                to="/admin/login"
                className="rounded-full bg-[#173E44] px-5 py-3 text-sm font-semibold text-white"
              >
                Admin login
              </Link>
              <Link
                to="/staff/login"
                className="rounded-full border border-[#D9E7E7] px-5 py-3 text-sm font-semibold text-[#365057]"
              >
                Staff login
              </Link>
            </div>
          </motion.section>
        </div>
      </div>
    );
  }

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
            Email OTP Verification
          </p>
          <h1 className="mt-5 text-4xl font-semibold tracking-[-0.04em] md:text-[4.1rem]">
            Finish the protected portal sign-in.
          </h1>
          <p className="mt-4 max-w-2xl text-base leading-7 text-white/78 md:text-lg">
            Enter the one-time password sent for your {pendingOtp.role} account. The OTP must be
            verified before any admin or staff route opens.
          </p>

          <div className="mt-8 rounded-[28px] border border-white/12 bg-white/8 p-5">
            <p className="text-sm font-semibold uppercase tracking-[0.16em] text-white/64">
              Security checks
            </p>
            <div className="mt-4 space-y-3 text-sm text-white/78">
              <p>1. The OTP expires after 5 minutes.</p>
              <p>2. Each code can be used only once.</p>
              <p>3. Invalid attempts are limited, and resend requests are rate-limited.</p>
            </div>
          </div>
        </motion.section>

        <motion.section
          initial={{ opacity: 0, x: 24 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.55, delay: 0.08 }}
          className="rounded-[34px] bg-white p-8 shadow-[0_18px_40px_rgba(94,81,60,0.14)] md:p-10"
        >
          <form onSubmit={handleVerify} className="space-y-5">
            <div className="rounded-[24px] bg-[#F5FAFA] px-5 py-5">
              <div className="flex items-start gap-3">
                <div className="mt-0.5 flex h-10 w-10 items-center justify-center rounded-full bg-[#EEF6F6] text-[#2D6B73]">
                  <Mail size={18} />
                </div>
                <div>
                  <p className="text-sm font-semibold uppercase tracking-[0.16em] text-[#7A979C]">
                    Verification delivery
                  </p>
                  <p className="mt-2 text-sm leading-6 text-[#607277]">
                    Code destination: <span className="font-semibold">{pendingOtp.email}</span>
                  </p>
                  <p className="mt-1 text-sm leading-6 text-[#607277]">
                    Expires in <span className="font-semibold">{formatCountdown(expiresInSeconds)}</span>
                  </p>
                </div>
              </div>
            </div>

            {!isOnline && (
              <div className="rounded-[22px] border border-[#D8E8EA] bg-[#F5FAFA] px-4 py-4 text-sm text-[#48656A]">
                You are offline. Reconnect before verifying the one-time password.
              </div>
            )}

            {isOtpExpired && (
              <div className="rounded-[22px] border border-[#F2D4DA] bg-[#FBECEF] px-4 py-4 text-sm text-[#B23949]">
                This one-time password expired. Request a new code or sign in again.
              </div>
            )}

            <div>
              <label className="mb-2 block text-sm font-medium text-[#415D62]">
                Verification code
              </label>
              <input
                inputMode="numeric"
                autoComplete="one-time-code"
                value={otpCode}
                onChange={(event) =>
                  setOtpCode(event.target.value.replace(/\D+/g, "").slice(0, 6))
                }
                disabled={isSubmitting}
                className="w-full rounded-[20px] border border-[#D9E7E7] px-4 py-3 outline-none transition focus:border-[#2D9B9B]"
                placeholder="Enter the 6-digit code"
              />
            </div>

            <button
              type="submit"
              disabled={isSubmitting || isOtpExpired}
              className="inline-flex w-full items-center justify-center gap-2 rounded-[22px] bg-[#173E44] px-5 py-3 text-sm font-semibold text-white transition hover:bg-[#1F4E55] disabled:cursor-not-allowed disabled:opacity-70"
            >
              {isSubmitting ? "Verifying..." : "Verify and continue"}
              <ShieldCheck size={16} />
            </button>

            <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
              <button
                type="button"
                onClick={handleResend}
                disabled={isResending || resendInSeconds > 0}
                className="font-semibold text-[#2D6B73] underline underline-offset-4 disabled:cursor-not-allowed disabled:no-underline disabled:opacity-60"
              >
                {isResending
                  ? "Sending new code..."
                  : resendInSeconds > 0
                    ? `Resend available in ${formatCountdown(resendInSeconds)}`
                    : "Resend code"}
              </button>
              <button
                type="button"
                onClick={() => {
                  clearPendingOtp();
                  navigate(`/${pendingOtp.role}/login`, { replace: true });
                }}
                className="font-semibold text-[#607277] underline underline-offset-4"
              >
                Start over
              </button>
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
