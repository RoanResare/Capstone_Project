// Vite substitutes these import.meta.env values into the browser bundle at
// build time. Keep the client and UI status check on this single source.
export const supabaseUrl = String(import.meta.env.VITE_SUPABASE_URL || "").trim();
export const supabaseAnonKey = String(import.meta.env.VITE_SUPABASE_ANON_KEY || "").trim();
export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey);
