export function monitorSessionSecurity({ verify, onFailure, onVerified, onNetworkChange, router,
  window, document, connection, intervalMs = 5000 }) {
  let disposed = false;
  let checking = false;
  let queued = false;
  const check = async () => {
    if (disposed || document.visibilityState === "hidden") return;
    if (checking) { queued = true; return; }
    checking = true;
    try {
      await verify();
      if (!disposed && !queued) onVerified();
    } catch (error) {
      if (!disposed) { disposed = true; onFailure(error); }
    } finally {
      checking = false;
      if (queued && !disposed) { queued = false; void check(); }
    }
  };
  const networkChanged = () => { if (!disposed) { onNetworkChange(); void check(); } };
  let pathname = router.state.location.pathname;
  const unsubscribe = router.subscribe((state) => {
    if (state.location.pathname !== pathname) { pathname = state.location.pathname; void check(); }
  });
  const interval = window.setInterval(check, intervalMs);
  window.addEventListener("focus", check);
  window.addEventListener("online", networkChanged);
  document.addEventListener("visibilitychange", check);
  connection?.addEventListener?.("change", networkChanged);
  void check();
  return () => {
    disposed = true;
    unsubscribe();
    window.clearInterval(interval);
    window.removeEventListener("focus", check);
    window.removeEventListener("online", networkChanged);
    document.removeEventListener("visibilitychange", check);
    connection?.removeEventListener?.("change", networkChanged);
  };
}
