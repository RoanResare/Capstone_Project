import { doc, onSnapshot } from "firebase/firestore";
import { auth, db, isFirebaseConfigured } from "../../firebase.js";
import { apiClient, buildAuthHeaders, extractApiError } from "./apiClient.js";

export function subscribeKaponPromo(onChange, onError) {
  if (!isFirebaseConfigured || !auth?.currentUser || !db) {
    onError(new Error("Sign in to load promotion availability."));
    return () => {};
  }
  return onSnapshot(doc(db, "promotions", "low-cost-kapon"), { includeMetadataChanges: true },
    (snapshot) => {
      if (!snapshot.metadata.fromCache) onChange(snapshot.exists() ? snapshot.data() : null);
    },
    (error) => onError(new Error(error.code === "permission-denied"
      ? "Promotion access was denied. Please publish the updated Firestore rules and sign in again."
      : "Unable to load promotion availability. Please try again later.")),
  );
}

export async function saveKaponPromo(payload) {
  const user = auth?.currentUser;
  if (!user) throw new Error("Sign in to manage promotions.");
  try {
    const token = await user.getIdToken();
    if (auth.currentUser !== user) throw new Error("Your account changed. Please try again.");
    const response = await apiClient.put("/auth/promotions/low-cost-kapon", payload, {
      headers: buildAuthHeaders(token),
    });
    return response.data.promo;
  } catch (error) {
    throw new Error(extractApiError(error, "Unable to save the promotion."));
  }
}
