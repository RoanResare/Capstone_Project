import { createClient } from "@supabase/supabase-js";
import { getDatabaseAccessToken } from "./app/services/databaseToken.js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error("Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY, then restart Vite.");
}

// Only the publishable key belongs in browser code. Service-role credentials
// are loaded by the backend through process.env and must never use VITE_.
export const supabase = createClient(supabaseUrl, supabaseAnonKey,
  import.meta.env.VITE_DATABASE_PROVIDER === "postgres"
    ? { accessToken: getDatabaseAccessToken }
    : undefined);

export default supabase;
