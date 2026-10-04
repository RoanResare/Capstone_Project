import { auth } from "../../firebase.js";
import { apiClient, buildAuthHeaders } from "./apiClient.js";

export async function verifyActiveSessionSecurity(accessToken = "") {
  const token = auth?.currentUser ? await auth.currentUser.getIdToken() : accessToken;
  if (!token) throw new Error("You must be signed in to perform this action.");
  await apiClient.get("/auth/session-security", { headers: buildAuthHeaders(token), timeout: 10000 });
}
