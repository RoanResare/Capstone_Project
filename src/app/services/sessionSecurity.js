import { apiClient, buildAuthHeaders } from "./apiClient.js";
import { getSupabaseAccessToken } from "./supabaseSession.js";

export async function verifyActiveSessionSecurity(accessToken = "") {
  const token = await getSupabaseAccessToken() || accessToken;
  if (!token) throw new Error("You must be signed in to perform this action.");
  await apiClient.get("/auth/session-security", { headers: buildAuthHeaders(token), timeout: 10000 });
}
