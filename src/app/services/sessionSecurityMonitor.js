export function monitorSessionSecurity({ verify, router, window, document, connection, onViolation, intervalMs = 5000 }) {
  let disposed = false;
  let checking = false;
  let queued = false;
  const isDashboard = () => /^\/(customer|admin|staff)\/dashboard(?:\/|$)/.test(router.state.location.pathname);
  const check = async () => {
    if (disposed || !isDashboard() || document.visibilityState === "hidden") return;
    if (checking) { queued = true; return; }
    checking = true;
    try {
      await verify();
    } catch (error) {
      if (!disposed && error?.response?.data?.details?.code === "SESSION_SECURITY_VIOLATION") {
        disposed = true;
        onViolation(error.response.data.message);
      }
      // Offline/timeouts are retried; they are not evidence of VPN use.
    } finally {
      checking = false;
      if (queued && !disposed) { queued = false; void check(); }
    }
  };
  let locationKey = router.state.location.key;
  const unsubscribe = router.subscribe((state) => {
    if (locationKey !== state.location.key) { locationKey = state.location.key; void check(); }
  });
  const timer = window.setInterval(check, intervalMs);
  window.addEventListener("focus", check);
  window.addEventListener("online", check);
  document.addEventListener("visibilitychange", check);
  connection?.addEventListener?.("change", check);
  void check();
  return () => {
    disposed = true;
    unsubscribe();
    window.clearInterval(timer);
    window.removeEventListener("focus", check);
    window.removeEventListener("online", check);
    document.removeEventListener("visibilitychange", check);
    connection?.removeEventListener?.("change", check);
  };
}
