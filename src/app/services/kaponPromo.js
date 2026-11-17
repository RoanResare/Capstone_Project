import { doc, getDoc, onSnapshot, isPostgresEnabled } from "./database.js";
import { apiClient, buildAuthHeaders, extractApiError } from "./apiClient.js";
import { db, isSupabaseConfigured } from "./supabaseDatabase.js";
import { auth, getSupabaseAccessToken } from "./supabaseSession.js";
import { readJsonCache, removeJsonCache, writeJsonCache } from "../utils/browserState.js";

const KAPON_PROMO_CACHE_KEY = "furfection-cache:lowCostKaponPromo";
const KAPON_PROMO_CACHE_TTL_MS = 5 * 60 * 1000;

export function subscribeKaponPromo(onChange, onError) {
  if (!isSupabaseConfigured || !auth?.currentUser || !db) {
    onError(new Error("Sign in to load promotion availability."));
    return () => {};
  }
  if (isPostgresEnabled) {
    const reference = doc(db, "lowCostKaponPromo", "low-cost-kapon");
    let disposed = false;
    let readVersion = 0;
    let boundaryTimer;
    const apply = snapshot => {
      if (disposed) return;
      const raw = snapshot.exists() ? snapshot.data() : null;
      const promo = raw && { ...raw, clockReceivedAt: performance.now() };
      clearTimeout(boundaryTimer);
      const delay = promo?.startsAt && Date.parse(promo.startsAt) - promo.serverNow;
      if (delay > 0) boundaryTimer = setTimeout(() => { void refresh(); }, Math.min(delay + 50, 2147483647));
      if (promo) writeJsonCache(KAPON_PROMO_CACHE_KEY, promo);
      else removeJsonCache(KAPON_PROMO_CACHE_KEY);
      onChange(promo);
    };
    const refresh = async () => {
      if (disposed) return;
      const version = ++readVersion;
      try {
        const snapshot = await getDoc(reference);
        if (!disposed && version === readVersion) apply(snapshot);
      } catch (error) {
        if (!disposed && version === readVersion) onError(new Error(extractApiError(error, "Unable to load promotion availability.")));
      }
    };
    // Realtime is an update channel, not a prerequisite for managing the promo.
    // All fallback reads use the same authenticated API and access checks.
    void refresh();
    const unsubscribe = onSnapshot(reference, snapshot => {
      readVersion++;
      apply(snapshot);
    }, () => { void refresh(); });
    const refreshOnFocus = () => { if (document.visibilityState !== "hidden") void refresh(); };

    window.addEventListener("focus", refreshOnFocus);
    document.addEventListener("visibilitychange", refreshOnFocus);
    return () => {
      disposed = true;
      clearTimeout(boundaryTimer);
      window.removeEventListener("focus", refreshOnFocus);
      document.removeEventListener("visibilitychange", refreshOnFocus);
      unsubscribe();
    };
  }
  const cachedPromo = readJsonCache(KAPON_PROMO_CACHE_KEY, KAPON_PROMO_CACHE_TTL_MS);
  if (cachedPromo) onChange(cachedPromo);
  let disposed = false;
  const refresh = async (force = false) => {
    if (disposed || document.visibilityState === "hidden") return;
    if (!force) {
      const latest = readJsonCache(KAPON_PROMO_CACHE_KEY, KAPON_PROMO_CACHE_TTL_MS);
      if (latest) { onChange(latest); return; }
    }
    try {
      const snapshot = await getDoc(doc(db, "lowCostKaponPromo", "low-cost-kapon"));
      if (disposed) return;
      if (snapshot.exists()) {
        const data = snapshot.data();
        writeJsonCache(KAPON_PROMO_CACHE_KEY, data);
        onChange(data);
      } else {
        removeJsonCache(KAPON_PROMO_CACHE_KEY);
        onChange(null);
      }
    } catch (error) {
      if (!disposed) onError(new Error(error.code === "permission-denied"
        ? "Promotion access was denied. Please sign in again or contact an administrator."
        : "Unable to load promotion availability. Please try again later."));
    }
  };
  void refresh();
  const refreshOnFocus = () => { void refresh(true); };
  window.addEventListener("focus", refreshOnFocus);
  document.addEventListener("visibilitychange", refreshOnFocus);
  return () => { disposed = true; window.removeEventListener("focus", refreshOnFocus); document.removeEventListener("visibilitychange", refreshOnFocus); };
}

export async function saveKaponPromo(payload) {
  const user = auth?.currentUser;
  if (!user) throw new Error("Sign in to manage promotions.");
  try {
    const token = await getSupabaseAccessToken();
    const response = await apiClient.put("/auth/promotions/low-cost-kapon", payload, { headers: buildAuthHeaders(token) });
    const promo = { ...response.data.promo, clockReceivedAt: performance.now() };
    writeJsonCache(KAPON_PROMO_CACHE_KEY, promo);
    return promo;
  } catch (error) { throw new Error(extractApiError(error, "Unable to save the promotion.")); }
}
export async function getKaponServerTime() {
  const token = await getSupabaseAccessToken();
  const response = await apiClient.get("/auth/promotions/low-cost-kapon/clock", { headers: buildAuthHeaders(token) });
  const time = Date.parse(response.data.serverNow);
  if (!Number.isFinite(time)) throw new Error("Unable to confirm server time. Please reopen the form.");
  return time;
}
