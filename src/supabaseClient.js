import { createClient } from "@supabase/supabase-js";
import { supabaseAnonKey, supabaseUrl } from "./app/services/supabaseConfig.js";
const fallbackSupabaseUrl = "http://127.0.0.1:54321";
const fallbackSupabaseAnonKey = "missing-supabase-anon-key";

// Only the publishable key belongs in browser code. Service-role credentials
// are loaded by the backend through process.env and must never use VITE_.
const persistencePreferenceKey = "furfection-supabase-session-persistence";
let useLocalStorage = (() => {
  try { return globalThis.localStorage?.getItem(persistencePreferenceKey) !== "session"; }
  catch { return true; }
})();

const authStorage = {
  getItem(key) {
    try { return (useLocalStorage ? globalThis.localStorage : globalThis.sessionStorage)?.getItem(key) ?? null; }
    catch { return null; }
  },
  setItem(key, value) {
    try { (useLocalStorage ? globalThis.localStorage : globalThis.sessionStorage)?.setItem(key, value); }
    catch { /* Browser storage may be disabled; Supabase reports session loss on reload. */ }
  },
  removeItem(key) {
    try { globalThis.localStorage?.removeItem(key); globalThis.sessionStorage?.removeItem(key); }
    catch { /* Best-effort removal from both browser stores. */ }
  },
};

export function setSupabaseSessionPersistence(rememberDevice) {
  useLocalStorage = rememberDevice === true;
  try { globalThis.localStorage?.setItem(persistencePreferenceKey, useLocalStorage ? "local" : "session"); }
  catch { /* The session still works for the active tab if preferences cannot be saved. */ }
}

export const supabase = createClient(supabaseUrl || fallbackSupabaseUrl, supabaseAnonKey || fallbackSupabaseAnonKey, {
  auth: {
    storage: authStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: true,
  },
});

export default supabase;
