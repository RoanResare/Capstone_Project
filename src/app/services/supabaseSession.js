import { supabase, setSupabaseSessionPersistence } from "../../supabaseClient.js";
import { apiClient, buildAuthHeaders } from "./apiClient.js";

let cachedSession = null;
supabase.auth.getSession().then(({ data }) => { cachedSession = data.session || null; }).catch(() => {});
supabase.auth.onAuthStateChange((_event, session) => { cachedSession = session || null; });

export function getCachedSupabaseSession() { return cachedSession; }
export { setSupabaseSessionPersistence };
export const auth = {
  get currentUser() { return cachedSession?.user || null; },
};

export async function getSupabaseSession() {
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  cachedSession = data.session || null;
  return cachedSession;
}

export async function getSupabaseAccessToken() {
  return (await getSupabaseSession())?.access_token || "";
}

export async function waitForSupabaseUserSession(expectedUid = "") {
  const expected = String(expectedUid || "").trim();
  const session = await getSupabaseSession();
  const user = session?.user || null;
  if (!user || !expected || user.id === expected) return user;
  const profile = await loadSupabaseProfile(session.access_token);
  return profile?.uid === expected ? user : null;
}

export async function loadSupabaseProfile(accessToken = "") {
  const token = accessToken || await getSupabaseAccessToken();
  if (!token) throw new Error("You must be signed in to load your account.");
  const { data } = await apiClient.get("/auth/me", { headers: buildAuthHeaders(token), timeout: 10000 });
  return data.user;
}

export async function installSupabaseSession(session) {
  if (!session?.access_token || !session?.refresh_token) throw new Error("The server did not return a complete Supabase session.");
  const { data, error } = await supabase.auth.setSession({
    access_token: session.access_token,
    refresh_token: session.refresh_token,
  });
  if (error) throw error;
  cachedSession = data.session || null;
  return data.session;
}

export async function signOutSupabase() {
  const { error } = await supabase.auth.signOut();
  cachedSession = null;
  if (error) throw error;
}

export function subscribeSupabaseAuth(callback) {
  const { data } = supabase.auth.onAuthStateChange((event, session) => {
    cachedSession = session || null;
    // Run application work after Supabase releases its auth lock; callbacks may
    // need to refresh tokens or sign out as part of recovery.
    setTimeout(() => callback(event, cachedSession), 0);
  });
  return () => data.subscription.unsubscribe();
}

export { supabase };
