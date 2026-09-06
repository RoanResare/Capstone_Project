import { useState } from "react";
import { motion } from "motion/react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { UserPlus } from "lucide-react";
import { PasswordStrengthMeter } from "./PasswordStrengthMeter.jsx";
import { useAuth } from "../context/AuthContext.jsx";
import { resolveHomePath } from "../utils/roleUtils.js";

export function CustomerSignup() {
  const navigate = useNavigate();
  const {
    currentUser,
    firebaseConfigError,
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

  if (!isLoading && isAuthenticated && currentUser) {
    return <Navigate to={homePath || resolveHomePath(currentUser.role)} replace />;
  }

  const handleChange = (field) => (event) => {
    const value = event.target.value;
    setForm((current) => ({ ...current, [field]: value }));
  };

  const handleSubmit = async (event) => {
    event.preventDefault();

    if (isSubmitting) {
      return;
    }

    setIsSubmitting(true);
    setFeedback({ type: "", message: "" });

    try {
      const result = await signUp({
        fullName: form.fullName,
        username: form.username,
        email: form.email,
        phone: form.phone,
        password: form.password,
        confirmPassword: form.confirmPassword,
      });

      if (!result.ok) {
        setFeedback({ type: "error", message: result.error });
        return;
      }

      navigate(result.homePath || "/customer/dashboard", { replace: true });
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
            Firebase Sign Up
          </p>
          <h1 className="mt-5 text-4xl font-semibold tracking-[-0.04em] md:text-[4.2rem]">
            Create your account with Firebase email and password.
          </h1>
          <p className="mt-4 max-w-2xl text-base leading-7 text-white/78 md:text-lg">
            Registration now goes directly through Firebase Authentication. Once your account is
            created, the app signs you in immediately and saves your profile in {"users/{uid}"}
            without relying on the shared portal lookup flow.
          </p>

          <div className="mt-8 rounded-[28px] border border-white/12 bg-white/8 p-5">
            <p className="text-sm font-semibold uppercase tracking-[0.16em] text-white/64">
              What happens next
            </p>
            <div className="mt-4 space-y-3 text-sm text-white/78">
              <p>1. Firebase creates your email/password account.</p>
              <p>2. Your customer profile is created after authentication finishes.</p>
              <p>3. You are signed in automatically and taken to your dashboard.</p>
            </div>
          </div>

          <p className="mt-8 text-sm text-white/74">
            Already have an account?{" "}
            <Link
              to="/login"
              className="font-semibold text-white underline underline-offset-4"
            >
              Sign in here
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
                Firebase client setup is incomplete. Fill the `VITE_FIREBASE_*` values in the
                root `.env` to finish the sign-up flow.
              </div>
            )}
            {!isOnline && (
              <div className="rounded-[22px] border border-[#D8E8EA] bg-[#F5FAFA] px-4 py-4 text-sm text-[#48656A]">
                You are offline. Reconnect before creating a Firebase account so the auth record
                and Firestore profile can be created together.
              </div>
            )}

            <div>
              <label className="mb-2 block text-sm font-medium text-[#415D62]">Full name</label>
              <input
                value={form.fullName}
                onChange={handleChange("fullName")}
                disabled={isSubmitting}
                className="w-full rounded-[20px] border border-[#D9E7E7] px-4 py-3 outline-none transition focus:border-[#2D9B9B]"
                placeholder="Enter your full name"
              />
            </div>

            <div>
              <label className="mb-2 block text-sm font-medium text-[#415D62]">Email</label>
              <input
                type="email"
                value={form.email}
                onChange={handleChange("email")}
                disabled={isSubmitting}
                className="w-full rounded-[20px] border border-[#D9E7E7] px-4 py-3 outline-none transition focus:border-[#2D9B9B]"
                placeholder="Enter your email"
              />
            </div>

            <div>
              <label className="mb-2 block text-sm font-medium text-[#415D62]">
                Username
              </label>
              <input
                value={form.username}
                onChange={handleChange("username")}
                disabled={isSubmitting}
                className="w-full rounded-[20px] border border-[#D9E7E7] px-4 py-3 outline-none transition focus:border-[#2D9B9B]"
                placeholder="Choose a profile username"
              />
              <p className="mt-2 text-xs text-[#7A9297]">
                This username is stored on your customer profile. Customer sign-in uses email and
                password only.
              </p>
            </div>

            <div>
              <label className="mb-2 block text-sm font-medium text-[#415D62]">
                Phone number
              </label>
              <input
                value={form.phone}
                onChange={handleChange("phone")}
                disabled={isSubmitting}
                className="w-full rounded-[20px] border border-[#D9E7E7] px-4 py-3 outline-none transition focus:border-[#2D9B9B]"
                placeholder="Optional phone number"
              />
            </div>

            <div className="grid gap-5 md:grid-cols-2">
              <div>
                <label className="mb-2 block text-sm font-medium text-[#415D62]">Password</label>
                <input
                  type="password"
                  value={form.password}
                  onChange={handleChange("password")}
                  disabled={isSubmitting}
                  className="w-full rounded-[20px] border border-[#D9E7E7] px-4 py-3 outline-none transition focus:border-[#2D9B9B]"
                  placeholder="Create a password"
                />
                <PasswordStrengthMeter password={form.password} />
              </div>

              <div>
                <label className="mb-2 block text-sm font-medium text-[#415D62]">
                  Confirm password
                </label>
                <input
                  type="password"
                  value={form.confirmPassword}
                  onChange={handleChange("confirmPassword")}
                  disabled={isSubmitting}
                  className="w-full rounded-[20px] border border-[#D9E7E7] px-4 py-3 outline-none transition focus:border-[#2D9B9B]"
                  placeholder="Repeat your password"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={isSubmitting}
              className="inline-flex w-full items-center justify-center gap-2 rounded-[22px] bg-[#2D9B9B] px-5 py-3 text-sm font-semibold text-white transition hover:bg-[#288A8A]"
            >
              Create account
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
