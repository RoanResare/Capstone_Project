import { auth } from "../../firebase.js";
import { apiClient, buildAuthHeaders } from "./apiClient.js";

let cached;
let pending;
export async function getDatabaseAccessToken() {
  const user = auth?.currentUser;
  if (!user) { cached = null; pending = null; return null; }
  const firebaseToken = await user.getIdToken();
  if (auth.currentUser !== user) throw new Error("Your account changed.");
  if (cached?.user === user && cached.firebaseToken === firebaseToken && cached.expiresAt > Date.now() + 45_000) return cached.token;
  if (pending?.user === user && pending.firebaseToken === firebaseToken) return pending.promise;
  const promise = (async () => {
    const response = await apiClient.get("/database/token", { headers: buildAuthHeaders(firebaseToken) });
    if (auth.currentUser !== user) throw new Error("Your account changed.");
    cached = { user, firebaseToken, token: response.data.token, expiresAt: Date.now() + response.data.expiresIn * 1000 };
    return cached.token;
  })().finally(() => { if (pending?.promise === promise) pending = null; });
  pending = { user, firebaseToken, promise };
  return promise;
}
