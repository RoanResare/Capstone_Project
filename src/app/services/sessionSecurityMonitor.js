export function monitorSessionSecurity({ verify, router, window, document, connection, onViolation, intervalMs = 2000 }) {
  let disposed = false;
  let checking = false;
  let queued = false;
  const isSessionRoute = () => !/^\/(login|signup|customer-signup|forgot-password|reset-password)(?:\/|$)/.test(router.state.location.pathname);
  const check = async () => {
    if (disposed || !isSessionRoute() || document.visibilityState === "hidden") return;
    if (checking) { queued = true; return; }
    checking = true;
    try {
      await verify();
    } catch (error) {
      if (!disposed && error?.response?.data?.details?.code === "SESSION_SECURITY_VIOLATION") {
        disposed = true;
        onViolation(error.response.data.message, error);
      }
      // Offline/timeouts are retried; they are not evidence of VPN use.
    } finally {
      checking = false;
      if (queued && !disposed) { queued = false; void check(); }
    }
  };
  let locationKey = router.state.location.key;
  let navigationState = router.state.navigation?.state;
  let revalidationState = router.state.revalidation;
  const unsubscribe = router.subscribe((state) => {
    const changed = locationKey !== state.location.key
      || navigationState !== state.navigation?.state || revalidationState !== state.revalidation;
    locationKey = state.location.key;
    navigationState = state.navigation?.state;
    revalidationState = state.revalidation;
    if (changed) void check();
  });
  let lastActivityCheck = -Infinity;
  const checkActivity = () => {
    if (disposed || !isSessionRoute() || document.visibilityState === "hidden") return;
    const now = Date.now();
    if (now - lastActivityCheck < 1000) return;
    lastActivityCheck = now;
    void check();
  };
  const activityEvents = ["pointerdown", "keydown", "change"];
  activityEvents.forEach((event) => document.addEventListener(event, checkActivity, { passive: true }));
  const timer = window.setInterval(check, intervalMs);
  window.addEventListener("pageshow", check);
  window.addEventListener("focus", check);
  window.addEventListener("online", check);
  document.addEventListener("visibilitychange", check);
  connection?.addEventListener?.("change", check);
  void check();
  return () => {
    disposed = true;
    unsubscribe();
    window.clearInterval(timer);
    window.removeEventListener("pageshow", check);
    activityEvents.forEach((event) => document.removeEventListener(event, checkActivity));
    window.removeEventListener("focus", check);
    window.removeEventListener("online", check);
    document.removeEventListener("visibilitychange", check);
    connection?.removeEventListener?.("change", check);
  };
}
