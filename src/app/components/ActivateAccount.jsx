import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { CheckCircle2, LoaderCircle, Mail, ShieldCheck } from "lucide-react";
import { activateCustomerEmail, resendCustomerEmailVerification } from "../services/authApi.js";

export function ActivateAccount() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const code = searchParams.get("oobCode") || "";
  const [status, setStatus] = useState(code ? "checking" : "invalid");
  const [message, setMessage] = useState(code ? "Checking your secure activation link..." : "This activation link is missing or incomplete.");
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

  const handleResend = async (event) => {
    event.preventDefault();
    if (resending || !email.trim()) return;
    setResending(true);
    try {
      const result = await resendCustomerEmailVerification(email.trim());
      if (result.activated) {
        setStatus("verified");
        setMessage(result.message || "Your email is verified and your account is active. You can now sign in.");
        window.setTimeout(() => navigate("/login?emailVerified=1", { replace: true }), 2200);
        return;
      }
      setStatus("sent");
      setMessage(result.message || "If an account is waiting for verification, a new activation link has been sent.");
    } catch (error) {
      setStatus("invalid");
      setMessage(error.message || "Unable to request a new link right now. Please try again shortly.");
    } finally {
      setResending(false);
    }
  };

  return (
    <main className="min-h-[calc(100vh-5rem)] bg-[#F6F0E7] px-5 py-12 sm:px-6">
      <section className="mx-auto max-w-xl rounded-[30px] bg-white p-7 text-center shadow-[0_20px_48px_rgba(94,81,60,0.14)] sm:p-10">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-[#EAF7F7] text-[#2D777B]">
          {status === "checking" ? <LoaderCircle className="animate-spin" size={28} /> : status === "verified" ? <CheckCircle2 size={30} /> : <ShieldCheck size={28} />}
        </div>
        <p className="mt-6 text-xs font-semibold uppercase tracking-[0.2em] text-[#7B9A9F]">Account activation</p>
        <h1 className="mt-2 text-3xl font-semibold text-[#20343B]">
          {status === "checking" ? "Verifying your email" : status === "verified" ? "Email verified" : status === "sent" ? "Check your inbox" : "Activation link needs attention"}
        </h1>
        <p role="status" aria-live="polite" className={`mt-4 rounded-2xl px-4 py-3 text-sm leading-6 ${status === "verified" || status === "sent" ? "bg-[#EAF7F7] text-[#2D6B73]" : status === "invalid" ? "bg-[#FBECEF] text-[#9B3342]" : "bg-[#F7FAFA] text-[#526B70]"}`}>
          {message}
        </p>

        {status === "verified" ? (
          <Link to="/login?emailVerified=1" className="mt-6 inline-flex min-h-12 w-full items-center justify-center rounded-2xl bg-[#173E44] px-5 py-3 text-sm font-semibold text-white">Continue to sign in</Link>
        ) : status === "checking" ? null : (
          <form onSubmit={handleResend} className="mt-6 space-y-3 text-left">
            <label htmlFor="verification-email" className="block text-sm font-medium text-[#415D62]">Email used to register</label>
            <div className="flex items-center gap-3 rounded-2xl border border-[#D9E7E7] px-4 py-3 focus-within:border-[#2D9B9B]">
              <Mail size={17} className="shrink-0 text-[#6B898E]" />
              <input id="verification-email" type="email" autoComplete="email" disabled readOnly value={email} className="min-w-0 flex-1 cursor-not-allowed bg-transparent text-[#20343B] opacity-100 outline-none" />
            </div>
            <button type="submit" disabled={resending || !email.trim()} className="min-h-12 w-full rounded-2xl bg-[#2D9B9B] px-5 py-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60">
              {resending ? "Requesting a new link..." : "Request a new activation link"}
            </button>
          </form>
        )}
        <p className="mt-6 text-sm text-[#607277]">Already activated? <Link to="/login" className="font-semibold text-[#2D6B73] underline underline-offset-4">Sign in</Link></p>
      </section>
    </main>
  );
}
