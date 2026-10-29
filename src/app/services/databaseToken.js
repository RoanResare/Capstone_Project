import { apiClient, buildAuthHeaders } from "./apiClient.js";

let cached;
let pending;
async function getActiveAuthContext() {
  try {
    const { supabase } = await import("../../supabaseClient.js");
    const { data, error } = await supabase.auth.getSession();
    if (!error && data.session?.access_token && data.session.user) {
      return { provider: "supabase-auth", user: data.session.user, token: data.session.access_token };
    }
  } catch (_error) {
    return null;
  }
}

export async function getApplicationAccessToken() {
  return (await getActiveAuthContext())?.token || "";
}

export async function getApplicationIdentity() {
  const context = await getActiveAuthContext();
  return context ? `${context.provider}:${context.user.id || context.user.uid || ""}` : "";
}

export async function getDatabaseAccessToken() {
  const context = await getActiveAuthContext();
  if (!context) { cached = null; pending = null; return null; }
  const { user, token: sourceToken } = context;
  const userId = user.id || user.uid || "";
  if (cached?.provider === context.provider && cached.userId === userId && cached.sourceToken === sourceToken && cached.expiresAt > Date.now() + 45_000) return cached.token;
  if (pending?.provider === context.provider && pending.userId === userId && pending.sourceToken === sourceToken) return pending.promise;
  const promise = (async () => {
    const response = await apiClient.get("/database/token", { headers: buildAuthHeaders(sourceToken) });
    const latest = await getActiveAuthContext();
    if (!latest || latest.provider !== context.provider || (latest.user.id || latest.user.uid || "") !== userId) throw new Error("Your account changed.");
    cached = { provider: context.provider, userId, sourceToken, token: response.data.token, expiresAt: Date.now() + response.data.expiresIn * 1000 };
    return cached.token;
  })().finally(() => { if (pending?.promise === promise) pending = null; });
  pending = { provider: context.provider, userId, sourceToken, promise };
  return promise;
}
