import { useEffect, useState } from "react";

export const OTP_SESSION_GRACE_MS = 500;

export function useOtpSessionRecovery({ pendingOtp, isLoading, isAuthenticated, restorePendingOtpSession }) {
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    if (isLoading || pendingOtp || isAuthenticated) return undefined;

    setChecked(false);
    if (restorePendingOtpSession("otp-page-mount")) {
      setChecked(true);
      return undefined;
    }

    // Recheck the same provider storage after the login handoff has settled.
    const timer = window.setTimeout(() => {
      restorePendingOtpSession("otp-page-grace");
      setChecked(true);
    }, OTP_SESSION_GRACE_MS);
    return () => window.clearTimeout(timer);
  }, [isLoading, pendingOtp, isAuthenticated, restorePendingOtpSession]);

  return isLoading || (!pendingOtp && !isAuthenticated && !checked);
}
