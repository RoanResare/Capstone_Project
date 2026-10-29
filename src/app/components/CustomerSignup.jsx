import { useRef, useState } from "react";
import { getTextValidationErrors, ACCOUNT_TEXT_FIELDS } from "../../../shared/textModeration.mjs";
import { motion } from "motion/react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { Eye, EyeOff, UserPlus, X } from "lucide-react";
import { AuthHeroPanel } from "./AuthHeroPanel.jsx";
import { AuthPageBackdrop } from "./AuthPageBackdrop.jsx";
import { useAuth } from "../context/AuthContext.jsx";
import { resolveHomePath } from "../utils/roleUtils.js";
import { getPasswordPolicyError } from "../utils/passwordPolicy.js";
import { getPhoneSubscriberInput, normalizePhilippineMobileNumber, PH_MOBILE_ERROR } from "../utils/phoneNumber.js";

function getPasswordStrength(password = "") {
  const checks = [
    password.length >= 6,
    /[A-Z]/.test(password),
    /[a-z]/.test(password),
    /[^A-Za-z0-9]/.test(password),
    /\d/.test(password),
  ];
  const score = checks.filter(Boolean).length;

  if (!password) return { label: "Not started", width: "0%", color: "bg-[#D8E8EA]" };
  if (score <= 2) return { label: "Weak", width: "33%", color: "bg-[#D85757]" };
  if (score <= 4) return { label: "Good", width: "66%", color: "bg-[#F0AA3D]" };
  return { label: "Strong", width: "100%", color: "bg-[#2D9B6F]" };
}

export function CustomerSignup() {
  const navigate = useNavigate();
  const {
    currentUser,
    supabaseConfigError,
    homePath,
    isAuthenticated,
    isLoading,
    isOnline,
    signUp,
  } = useAuth();
  const [form, setForm] = useState({
    fullName: "",
    username: "",
    email: "",
    phone: "",
    password: "",
    confirmPassword: "",
  });
  const [feedback, setFeedback] = useState({ type: "", message: "" });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [showTerms, setShowTerms] = useState(false);
  const [termsRead, setTermsRead] = useState(false);
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [termsReady, setTermsReady] = useState(false);
  const termsScrollRef = useRef(null);
  const passwordStrength = getPasswordStrength(form.password);
  const passwordPolicyError = form.password ? getPasswordPolicyError(form.password) : "";

  if (!isLoading && isAuthenticated && currentUser) {
    return <Navigate to={homePath || resolveHomePath(currentUser.role)} replace />;
  }

  const handleChange = (field) => (event) => {
    const value = field === "phone"
      ? getPhoneSubscriberInput(event.target.value)
      : event.target.value;
    setForm((current) => ({ ...current, [field]: value }));
    setFeedback((current) => current.type === "error" ? { type: "", message: "" } : current);
  };

  const handleSubmit = async (event) => {
    event.preventDefault();

    if (isSubmitting) {
      return;
    }

    // Password managers can update input values without dispatching onChange.
    // Snapshot before disabling inputs or opening terms, which causes a rerender.
    // Preserve passwords exactly; trimming would change the user's credentials.
    const submittedForm = Object.fromEntries(new FormData(event.currentTarget));
    setForm(submittedForm);

    if (!termsReady) {
      setShowTerms(true);
      setFeedback({ type: "", message: "" });
      return;
    }

    const textErrors = getTextValidationErrors(submittedForm, ACCOUNT_TEXT_FIELDS);
    if (Object.keys(textErrors).length) {
      setFeedback({ type: "error", message: Object.values(textErrors)[0] });
      return;
    }

    setIsSubmitting(true);
    setFeedback({ type: "", message: "" });

    try {
      const normalizedPhone = normalizePhilippineMobileNumber(submittedForm.phone);
      if (!normalizedPhone) {
        setFeedback({
          type: "error",
          message: PH_MOBILE_ERROR,
        });
        return;
      }

      if (!termsAccepted || !termsRead) {
        setTermsReady(false);
        setShowTerms(true);
        return;
      }

      const result = await signUp({
        fullName: submittedForm.fullName,
        username: submittedForm.username,
        email: submittedForm.email,
        phone: normalizedPhone,
        password: submittedForm.password,
        confirmPassword: submittedForm.confirmPassword,
      });

      if (!result.ok) {
        setFeedback({ type: "error", message: result.error });
        return;
      }

      if (result.verificationRequired) {
        setForm((current) => ({ ...current, password: "", confirmPassword: "" }));
        setFeedback({ type: "success", message: result.message, email: result.email });
        return;
      }

      navigate(result.homePath || "/customer/dashboard", { replace: true });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="relative isolate min-h-[calc(100vh-5rem)] bg-[#F6F0E7] px-4 py-6 sm:px-6 lg:py-8">
      <AuthPageBackdrop />
      <div className="relative z-10 mx-auto grid max-w-[1320px] items-start gap-5 lg:grid-cols-[0.92fr_1.08fr] lg:items-center lg:gap-6">
        <motion.div
          initial={{ opacity: 0, x: -24 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.55 }}
          className="order-1 lg:order-1"
        >
          <AuthHeroPanel />
        </motion.div>

        <motion.section
          initial={{ opacity: 0, x: 24 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.55, delay: 0.08 }}
          className="order-2 rounded-[24px] bg-white p-5 shadow-[0_22px_50px_rgba(94,81,60,0.16)] sm:p-6 lg:order-2 lg:p-7"
        >
          <div className="mb-5 text-center">
            <h1 className="text-3xl font-extrabold text-[#07545A]">Create Account</h1>
            <p className="mt-2 text-sm text-[#607277]">Join us to manage your pet care and appointments.</p>
          </div>
          <form noValidate onSubmit={handleSubmit} className="space-y-4">
            {supabaseConfigError && (
              <div className="rounded-[22px] border border-[#FFF0CC] bg-[#FFF9EA] px-4 py-4 text-sm text-[#8A6410]">
                Supabase client setup is incomplete. Fill the `VITE_SUPABASE_*` values in the
                root `.env` to finish the sign-up flow.
              </div>
            )}
            {!isOnline && (
              <div className="rounded-[22px] border border-[#D8E8EA] bg-[#F5FAFA] px-4 py-4 text-sm text-[#48656A]">
            You are offline. Reconnect before registering so we can securely send your activation link.
              </div>
            )}

            <div>
              <label className="mb-2 block text-sm font-medium text-[#415D62]">Full name</label>
              <input
                name="fullName"
                value={form.fullName}
                autoComplete="name"
                onChange={handleChange("fullName")}
                disabled={isSubmitting}
                className="w-full rounded-[20px] border border-[#D9E7E7] px-4 py-2.5 outline-none transition focus:border-[#2D9B9B]"
                placeholder="Enter your full name"
              />
            </div>

            <div>
              <label className="mb-2 block text-sm font-medium text-[#415D62]">Email</label>
              <input
                name="email"
                type="email"
                value={form.email}
                autoComplete="email"
                onChange={handleChange("email")}
                disabled={isSubmitting}
                className="w-full rounded-[20px] border border-[#D9E7E7] px-4 py-2.5 outline-none transition focus:border-[#2D9B9B]"
                placeholder="Enter your email"
              />
            </div>

            <div>
              <label className="mb-2 block text-sm font-medium text-[#415D62]">
                Username
              </label>
              <input
                name="username"
                value={form.username}
                autoComplete="username"
                onChange={handleChange("username")}
                disabled={isSubmitting}
                className="w-full rounded-[20px] border border-[#D9E7E7] px-4 py-2.5 outline-none transition focus:border-[#2D9B9B]"
                placeholder="Choose a profile username"
              />
              <p className="mt-2 text-xs text-[#7A9297]">
                This username is stored on your customer profile. You can use it or your email to
                sign in.
              </p>
            </div>

            <div>
              <label className="mb-2 block text-sm font-medium text-[#415D62]">
                Phone number
              </label>
              <label className="flex overflow-hidden rounded-[20px] border border-[#D9E7E7] bg-white transition focus-within:border-[#2D9B9B]">
                <span className="shrink-0 border-r border-[#E2ECEC] bg-[#F6FAFA] px-4 py-2.5 text-sm font-semibold text-[#33545A]">
                  +63
                </span>
                <input
                  name="phone"
                  value={form.phone}
                  onChange={handleChange("phone")}
                  disabled={isSubmitting}
                  type="tel"
                  inputMode="numeric"
                  pattern="9[0-9]{9}"
                  maxLength={10}
                  autoComplete="tel"
                  className="min-w-0 flex-1 px-4 py-2.5 outline-none"
                  placeholder="9XXXXXXXXX"
                />
              </label>
              <p className="mt-2 text-xs text-[#7A9297]">
                Format: +63 9XXXXXXXXX or 09XXXXXXXXX. A phone number can be used for up to 3 accounts.
              </p>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <label className="mb-2 block text-sm font-medium text-[#415D62]">Password</label>
                <div className="relative">
                  <input
                    name="password"
                    type={showPassword ? "text" : "password"}
                    value={form.password}
                    autoComplete="new-password"
                    onChange={handleChange("password")}
                    disabled={isSubmitting}
                    className="w-full rounded-[20px] border border-[#D9E7E7] px-4 py-2.5 pr-12 outline-none transition focus:border-[#2D9B9B]"
                    placeholder="Create a password"
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
                <p className="mt-2 text-xs text-[#607277]">
                  Use at least 6 characters with uppercase, lowercase, and a special character.
                </p>
                <div className="mt-3">
                  <div className="h-2 overflow-hidden rounded-full bg-[#E7F0F0]">
                    <div
                      className={`h-full rounded-full transition-all ${passwordStrength.color}`}
                      style={{ width: passwordStrength.width }}
                    />
                  </div>
                  <p className="mt-2 text-xs font-semibold text-[#607277]">
                    Password strength: {passwordStrength.label}
                    {passwordPolicyError ? ` - ${passwordPolicyError}` : ""}
                  </p>
                </div>
              </div>

              <div>
                <label className="mb-2 block text-sm font-medium text-[#415D62]">
                  Confirm password
                </label>
                <div className="relative">
                  <input
                    name="confirmPassword"
                    type={showConfirmPassword ? "text" : "password"}
                    value={form.confirmPassword}
                    autoComplete="new-password"
                    onChange={handleChange("confirmPassword")}
                    disabled={isSubmitting}
                    className="w-full rounded-[20px] border border-[#D9E7E7] px-4 py-2.5 pr-12 outline-none transition focus:border-[#2D9B9B]"
                    placeholder="Repeat your password"
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
              </div>
            </div>

            <button
              type="submit"
              disabled={isSubmitting}
              className="inline-flex w-full items-center justify-center gap-2 rounded-[22px] bg-[#2D9B9B] px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-[#288A8A]"
            >
              {isSubmitting ? "Creating account..." : "Create account"}
              <UserPlus size={16} />
            </button>

            <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
              <Link
                to="/login"
                className="font-semibold text-[#2D6B73] underline underline-offset-4"
              >
                Sign in instead
              </Link>
              <Link
                to="/forgot-password"
                className="font-semibold text-[#607277] underline underline-offset-4"
              >
                Forgot password?
              </Link>
            </div>
          </form>

          {feedback.message && (
            <p
              role={feedback.type === "error" ? "alert" : "status"}
              aria-live="polite"
              className={`mt-5 rounded-[22px] px-4 py-2.5 text-sm font-medium ${
                feedback.type === "error"
                  ? "bg-[#FBECEF] text-[#B23949]"
                  : "bg-[#EAF7F7] text-[#2D6B73]"
              }`}
            >
              {feedback.message}
            </p>
          )}
          {feedback.type === "success" && feedback.email && (
            <Link to={`/activate-account?email=${encodeURIComponent(feedback.email)}`} className="mt-3 inline-flex text-sm font-semibold text-[#2D6B73] underline underline-offset-4">
              Link expired or missing? Request another activation link
            </Link>
          )}
        </motion.section>
      </div>
      {showTerms && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#102D32]/60 p-4" onMouseDown={(event) => { if (event.target === event.currentTarget) setShowTerms(false); }}>
          <section role="dialog" aria-modal="true" aria-labelledby="signup-terms-title" className="w-full max-w-xl rounded-3xl bg-white p-5 shadow-2xl sm:p-6">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 id="signup-terms-title" className="text-xl font-semibold text-[#20343B]">Terms and Conditions and Privacy Policy</h2>
                <p className="mt-1 text-sm text-[#607277]">Scroll to the bottom to enable account creation.</p>
              </div>
              <button type="button" onClick={() => setShowTerms(false)} aria-label="Close terms and conditions" className="rounded-full p-2 text-[#607277] hover:bg-[#F1F7F7]"><X size={20} /></button>
            </div>
            <div
              ref={termsScrollRef}
              className="mt-5 max-h-[55vh] overflow-y-auto rounded-2xl border border-[#D9E7E7] bg-[#F8FCFC] p-5 text-sm leading-5 text-[#607277]"
              onScroll={(event) => {
                const element = event.currentTarget;
                if (element.scrollTop + element.clientHeight >= element.scrollHeight - 4) setTermsRead(true);
              }}
            >
              <p className="font-semibold text-[#20343B]">Account information and security</p>
              <p className="mt-2">Provide accurate information that belongs to you. Keep your password private and use your account only on devices you trust. You are responsible for activity performed through your account.</p>
              <p className="mt-4 font-semibold text-[#20343B]">Appointments and pet care</p>
              <p className="mt-2">Use the service to book appointments for pets under your care. Provide accurate contact and health details so clinic staff can coordinate appointments and appropriate care.</p>
              <p className="mt-4 font-semibold text-[#20343B]">Use of your information</p>
              <p className="mt-2">Your contact details are used for appointment coordination, account security, service updates, reminders, and clinic notices. Pet notes and optional photos may be reviewed by authorized clinic staff to support your pet's care.</p>
              <p className="mt-4 font-semibold text-[#20343B]">Responsible use</p>
              <p className="mt-2">Do not access another person's account, submit misleading information, or interfere with the service. The clinic may restrict accounts when needed to address misuse, safety, or security concerns.</p>
              <p className="mt-4">By continuing, you confirm that you have read and agree to these Terms and Conditions and the Privacy Policy.</p>
            </div>
            <label className="mt-4 flex items-start gap-3 text-sm font-semibold text-[#415D62]">
              <input type="checkbox" checked={termsAccepted} onChange={(event) => setTermsAccepted(event.target.checked)} disabled={!termsRead || isSubmitting} className="mt-1 h-4 w-4 accent-[#2D9B9B] disabled:cursor-not-allowed" />
              <span>I have read and agree to the Terms and Conditions and Privacy Policy.</span>
            </label>
            {!termsRead && <p className="mt-2 text-xs text-[#7A9297]">Scroll to the bottom of the terms before continuing.</p>}
            <button
              type="button"
              disabled={!termsRead || !termsAccepted || isSubmitting}
              onClick={() => { setTermsReady(true); setShowTerms(false); setFeedback({ type: "", message: "" }); }}
              className="mt-5 w-full rounded-xl bg-[#2D9B9B] px-5 py-2.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
            >
              Agree and continue
            </button>
          </section>
        </div>
      )}
    </div>
  );
}
