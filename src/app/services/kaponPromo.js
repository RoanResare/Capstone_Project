import { doc, getDoc, runTransaction } from "firebase/firestore";
import { auth, db, isFirebaseConfigured } from "../../firebase.js";
import { normalizePromoInput } from "../../../shared/lowCostKaponPromo.mjs";
import { readJsonCache, removeJsonCache, writeJsonCache } from "../utils/browserState.js";

const KAPON_PROMO_CACHE_KEY = "furfection-cache:lowCostKaponPromo";
const KAPON_PROMO_CACHE_TTL_MS = 5 * 60 * 1000;

export function subscribeKaponPromo(onChange, onError) {
  if (!isFirebaseConfigured || !auth?.currentUser || !db) {
    onError(new Error("Sign in to load promotion availability."));
    return () => {};
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
        ? "Promotion access was denied. Please publish the updated Firestore rules and sign in again."
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
  if (!isFirebaseConfigured || !db) throw new Error("Firebase is unavailable. Please try again later.");
  const { action, expectedRevision } = payload || {};
  if (!["activate", "edit", "deactivate"].includes(action) || !Number.isInteger(expectedRevision) || expectedRevision < 0) {
    throw new Error("A valid promo action and revision are required.");
  }
  const configuration = action === "deactivate" ? null : normalizePromoInput(payload);
  const reference = doc(db, "lowCostKaponPromo", "low-cost-kapon");
  const promo = await runTransaction(db, async (transaction) => {
    if (auth.currentUser !== user) throw new Error("Your account changed. Please try again.");
    const snapshot = await transaction.get(reference);
    const current = snapshot.data() || {};
    if ((current.revision || 0) !== expectedRevision) {
      throw new Error("The promotion was changed by another employee. Review the latest details and try again.");
    }
    if (action !== "activate" && current.isActive !== true) throw new Error("This promotion is no longer active.");
    if (action === "activate" && current.isActive === true) throw new Error("This promotion is already active. Use Edit Promo to change it.");
    if (configuration?.endsAt && configuration.endsAt <= new Date().toISOString()) throw new Error("End time must be in the future.");
    const next = action === "deactivate"
      ? { isActive: false, revision: expectedRevision + 1 }
      : { ...configuration, isActive: true, revision: expectedRevision + 1 };
    transaction.set(reference, next);
    return next;
  });
  writeJsonCache(KAPON_PROMO_CACHE_KEY, promo);
  return promo;
}
