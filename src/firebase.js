// Kept as a narrow compatibility boundary for existing PostgreSQL data
// services. Authentication and data access are provided by Supabase.
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const db = Object.freeze({ provider: "postgres" });
export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey);
