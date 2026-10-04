import { useEffect } from "react";
import { readRememberedCustomerLogin } from "./customerRememberMe.js";
import { readRememberedPortalLogin } from "./portalRememberMe.js";

export function useRememberedLogin(role, setForm, setFeedback, notify) {
  useEffect(() => {
    const customer = role && role !== "customer" ? null : readRememberedCustomerLogin();
    const portal = role === "customer" ? null : readRememberedPortalLogin(role);
    const remembered = [customer && { ...customer, role: "customer" }, portal]
      .filter((record) => record?.credentials)
      .sort((left, right) => right.credentials.savedAt - left.credentials.savedAt)[0];
    if (!remembered) return undefined;
    const expire = () => {
      const current = remembered.role === "customer"
        ? readRememberedCustomerLogin() : readRememberedPortalLogin(remembered.role);
      if (current.status !== "expired") return;
      setForm((current) => ({ ...current,
        identifier: current.identifier || remembered.credentials.identifier,
        password: "", rememberDevice: false }));
      const message = remembered.role === "customer"
        ? "Your remembered login expired after 2 weeks. Please re-enter your password to continue."
        : "Your trusted device expired after 2 weeks. Please re-enter your password and verify your login with a new code.";
      setFeedback({ type: "info", message });
      notify(message);
    };
    if (remembered.status === "expired") {
      expire();
      return undefined;
    }
    setForm((current) => ({ ...current,
      identifier: current.identifier || remembered.credentials.identifier,
      password: current.password || remembered.credentials.password,
      rememberDevice: true }));
    const timeout = window.setTimeout(expire, remembered.credentials.expiresAt - Date.now());
    return () => window.clearTimeout(timeout);
  }, [role]);
}
