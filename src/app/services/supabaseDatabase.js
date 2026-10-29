// Application data calls use the Supabase PostgreSQL API adapter.
import * as database from "./database.js";
import { isSupabaseConfigured } from "./supabaseConfig.js";

export const db = database;
export { isSupabaseConfigured };
