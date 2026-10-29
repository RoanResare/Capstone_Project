import { useEffect, useState } from "react";

export const OTP_SESSION_GRACE_MS = 500;

export function useOtpSessionRecovery({ pendingOtp, isLoading, isAuthenticated, restorePendingOtpSession }) {
  const [check, setCheck] = useState({ finished: false, found: false });

  useEffect(() => {
    setCheck({ finished: false, found: false });
    if (isLoading) return undefined;
    restorePendingOtpSession("otp-page-mount");

    // Recheck the same provider storage after the login handoff has settled.
    const timer = window.setTimeout(() => {
      const recovered = restorePendingOtpSession("otp-page-grace");
      setCheck({ finished: true, found: Boolean(recovered?.otpTicket) });
    }, OTP_SESSION_GRACE_MS);
    return () => window.clearTimeout(timer);
  }, [isLoading, restorePendingOtpSession]);

  return {
    isCheckingSession: isLoading || !check.finished,
    canShowMissingChallenge: !isLoading && check.finished && !check.found
      && !pendingOtp?.otpTicket && !isAuthenticated,
  };
}
