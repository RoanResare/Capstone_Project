// Legacy Firestore-shaped data calls delegate to the Supabase PostgreSQL adapter.
import * as database from "./database.js";
import { isSupabaseConfigured } from "./supabaseConfig.js";

export const db = database;
export { isSupabaseConfigured };
