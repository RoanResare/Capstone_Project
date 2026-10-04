import { auth } from "../../firebase.js";
import { apiClient, buildAuthHeaders } from "./apiClient.js";

export async function verifyActiveSessionSecurity() {
  const user = auth?.currentUser;
  if (!user) throw new Error("You must be signed in to perform this action.");
  const token = await user.getIdToken();
  await apiClient.get("/auth/session-security", {
    headers: buildAuthHeaders(token),
    timeout: 10000,
  });
}
