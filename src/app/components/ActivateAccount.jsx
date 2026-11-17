import { useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { CheckCircle2, LoaderCircle, Mail, ShieldCheck } from "lucide-react";
import { activateCustomerEmail, resendCustomerEmailVerification } from "../services/authApi.js";

export function ActivateAccount() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const location = useLocation();
  const code = searchParams.get("token_hash") || searchParams.get("oobCode") || "";
  const initialOtpMode = !code && searchParams.get("method") === "otp";
  const [otpMode, setOtpMode] = useState(initialOtpMode);
  const [otpCode, setOtpCode] = useState("");
  const [verifying, setVerifying] = useState(false);
  const verificationInFlight = useRef(false);
  const resendInFlight = useRef(false);
  const [status, setStatus] = useState(code ? "checking" : initialOtpMode && location.state?.deliveryStatus !== "pending" ? "sent" : "invalid");
  const [message, setMessage] = useState(code ? "Checking your secure activation link..." : initialOtpMode
    ? location.state?.deliveryMessage || "Enter the verification code sent to your email. If it has not arrived, request a new code."
    : "This activation link is missing or incomplete.");
  const [email, setEmail] = useState(searchParams.get("email") || "");
  const [resending, setResending] = useState(false);
  const attemptedCode = useRef({ code: "", request: null });

  useEffect(() => {
    if (!code) return undefined;
    if (attemptedCode.current.code !== code) {
      attemptedCode.current = { code, request: activateCustomerEmail(code) };
    }
    let active = true;
    setStatus("checking");
    setMessage("Checking your secure activation link...");
    attemptedCode.current.request
      .then((result) => {
        if (!active) return;
        setEmail(result.email || "");
        setStatus("verified");
        setMessage(result.message || "Your email is verified. You can now sign in.");
        window.setTimeout(() => navigate("/login?emailVerified=1", { replace: true }), 2200);
      })
      .catch((error) => {
        if (!active) return;
        setStatus("invalid");
        setMessage(error.message || "This activation link has expired or was already used. Request a new link to continue.");
      });
    return () => { active = false; };
  }, [code, navigate]);

  const handleVerifyCode = async (event) => {
    event.preventDefault();
    if (verificationInFlight.current || resendInFlight.current || status === "verified") return;
    if (!/^\d{6,10}$/.test(otpCode.trim()) || !email.trim()) {
      setStatus("invalid");
      setMessage("Enter your email and the verification code from your inbox.");
      return;
    }
    verificationInFlight.current = true;
    setVerifying(true);
    try {
      const result = await activateCustomerEmail("", email.trim(), otpCode.trim());
      setStatus("verified");
      setMessage(result.message || "Your email is verified. You can now sign in.");
      setOtpCode("");
    } catch (error) {
      setStatus("invalid");
      setMessage(error.message || "Unable to verify this code. Try again or request a new code.");
    } finally {
      verificationInFlight.current = false;
      setVerifying(false);
    }
  };

  const handleResend = async (event) => {
    event.preventDefault();
    if (resendInFlight.current || verificationInFlight.current || !email.trim()) return;
    resendInFlight.current = true;
    setResending(true);
    try {
      const result = await resendCustomerEmailVerification(email.trim());
      if (result.activated) {
        setStatus("verified");
        setMessage(result.message || "Your email is verified and your account is active. You can now sign in.");
        window.setTimeout(() => navigate("/login?emailVerified=1", { replace: true }), 2200);
        return;
      }
      setStatus(result.deliveryStatus === "sent" && result.messageId ? "sent" : "invalid");
      if (result.verificationMethod === "otp") { setOtpMode(true); setOtpCode(""); }
      setMessage(result.message || "No activation email was confirmed. Please try again or contact the clinic.");
    } catch (error) {
      setStatus("invalid");
      setMessage(error.message || "Unable to request a new link right now. Please try again shortly.");
    } finally {
      resendInFlight.current = false;
      setResending(false);
    }
  };

  return (
    <main className="min-h-[calc(100vh-5rem)] bg-[#F6F0E7] px-5 py-10 sm:px-6">
      <section className="mx-auto max-w-xl rounded-[24px] bg-white p-5 text-center shadow-[0_20px_48px_rgba(94,81,60,0.14)] sm:p-8">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-[#EAF7F7] text-[#2D777B]">
          {status === "checking" ? <LoaderCircle className="animate-spin" size={28} /> : status === "verified" ? <CheckCircle2 size={30} /> : <ShieldCheck size={28} />}
        </div>
        <p className="mt-5 text-xs font-semibold uppercase tracking-[0.2em] text-[#7B9A9F]">Account activation</p>
        <h1 className="mt-2 text-3xl font-semibold text-[#20343B]">
          {status === "checking" ? "Verifying your email" : status === "verified" ? "Email verified" : otpMode ? "Verify your email" : status === "sent" ? "Check your inbox" : "Activation link needs attention"}
        </h1>
        <p role="status" aria-live="polite" className={`mt-4 rounded-2xl px-4 py-2.5 text-sm leading-5 ${status === "verified" || status === "sent" ? "bg-[#EAF7F7] text-[#2D6B73]" : status === "invalid" ? "bg-[#FBECEF] text-[#9B3342]" : "bg-[#F7FAFA] text-[#526B70]"}`}>
          {message}
        </p>

        {otpMode && status !== "verified" && (
          <form onSubmit={handleVerifyCode} className="mt-5 space-y-3 text-left">
            <label htmlFor="signup-otp" className="block text-sm font-medium text-[#415D62]">Verification code</label>
            <input id="signup-otp" inputMode="numeric" autoComplete="one-time-code" maxLength={10} value={otpCode}
              onChange={(event) => setOtpCode(event.target.value.replace(/\D/g, ""))} disabled={verifying || resending}
              className="min-h-12 w-full rounded-2xl border border-[#D9E7E7] px-4 py-2.5 tracking-[0.2em] outline-none focus:border-[#2D9B9B]" />
            <button type="submit" disabled={verifying || resending || !otpCode.trim()} className="min-h-12 w-full rounded-2xl bg-[#173E44] px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-60">
              {verifying ? "Verifying..." : "Verify code"}
            </button>
          </form>
        )}
        {status === "verified" ? (
          <Link to="/login?emailVerified=1" className="mt-5 inline-flex min-h-12 w-full items-center justify-center rounded-2xl bg-[#173E44] px-5 py-2.5 text-sm font-semibold text-white">Continue to sign in</Link>
        ) : status === "checking" ? null : (
          <form onSubmit={handleResend} className="mt-5 space-y-3 text-left">
            <label htmlFor="verification-email" className="block text-sm font-medium text-[#415D62]">Email used to register</label>
            <div className="flex items-center gap-3 rounded-2xl border border-[#D9E7E7] px-4 py-2.5 focus-within:border-[#2D9B9B]">
              <Mail size={17} className="shrink-0 text-[#6B898E]" />
              <input id="verification-email" type="email" autoComplete="email" disabled={resending || verifying || Boolean(code)} readOnly={Boolean(code)} value={email} onChange={(event) => setEmail(event.target.value)} className="min-w-0 flex-1 bg-transparent text-[#20343B] opacity-100 outline-none" />
            </div>
            <button type="submit" disabled={resending || verifying || !email.trim()} className="min-h-12 w-full rounded-2xl bg-[#2D9B9B] px-5 py-2.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60">
              {resending ? "Requesting a new code..." : "Request a new verification code"}
            </button>
          </form>
        )}
        <p className="mt-5 text-sm text-[#607277]">Already activated? <Link to="/login" className="font-semibold text-[#2D6B73] underline underline-offset-4">Sign in</Link></p>
      </section>
    </main>
  );
}
