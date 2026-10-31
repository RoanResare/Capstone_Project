import { doc, getDoc, runTransaction, onSnapshot, isPostgresEnabled } from "./database.js";
import { apiClient, buildAuthHeaders, extractApiError } from "./apiClient.js";
import { db, isSupabaseConfigured } from "./supabaseDatabase.js";
import { auth, getSupabaseAccessToken } from "./supabaseSession.js";
import { normalizePromoInput, validatePromoStart } from "../../../shared/lowCostKaponPromo.mjs";
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
    const apply = snapshot => {
      if (disposed) return;
      const promo = snapshot.exists() ? snapshot.data() : null;
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
    const interval = setInterval(refreshOnFocus, 30000);
    window.addEventListener("focus", refreshOnFocus);
    document.addEventListener("visibilitychange", refreshOnFocus);
    return () => {
      disposed = true;
      clearInterval(interval);
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
  if (isPostgresEnabled) {
    try {
      const token = await getSupabaseAccessToken();
      const response = await apiClient.put("/auth/promotions/low-cost-kapon", payload, { headers: buildAuthHeaders(token) });
      writeJsonCache(KAPON_PROMO_CACHE_KEY, response.data.promo);
      return response.data.promo;
    } catch (error) { throw new Error(extractApiError(error, "Unable to save the promotion.")); }
  }
  if (!isSupabaseConfigured || !db) throw new Error("Supabase is unavailable. Please try again later.");
  const { action, expectedRevision } = payload || {};
  if (!["activate", "edit", "deactivate"].includes(action) || !Number.isInteger(expectedRevision) || expectedRevision < 0) {
    throw new Error("A valid promo action and revision are required.");
  }
  const configuration = action === "deactivate" ? null : normalizePromoInput(payload);
  const reference = doc(db, "lowCostKaponPromo", "low-cost-kapon");
  const promo = await runTransaction(db, async (transaction) => {
    if (auth.currentUser?.id !== user?.id) throw new Error("Your account changed. Please try again.");
    const snapshot = await transaction.get(reference);
    const current = snapshot.data() || {};
    if ((current.revision || 0) !== expectedRevision) {
      throw new Error("The promotion was changed by another employee. Review the latest details and try again.");
    }
    if (action !== "activate" && current.isActive !== true) throw new Error("This promotion is no longer active.");
    if (action === "activate" && current.isActive === true) throw new Error("This promotion is already active. Use Edit Promo to change it.");
    if (configuration?.endsAt && configuration.endsAt <= new Date().toISOString()) throw new Error("End time must be in the future.");
    if (configuration) validatePromoStart(configuration.startsAt, { previousStartsAt: action === "edit" ? current.startsAt : null });
    const next = action === "deactivate"
      ? { isActive: false, revision: expectedRevision + 1 }
      : { ...configuration, isActive: true, revision: expectedRevision + 1 };
    transaction.set(reference, next);
    return next;
  });
  writeJsonCache(KAPON_PROMO_CACHE_KEY, promo);
  return promo;
}
