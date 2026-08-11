import { createClient } from '@supabase/supabase-js';
import type { Database } from '../integrations/supabase/types';

const env =
  (typeof import.meta !== 'undefined' && import.meta.env) ||
  (typeof process !== 'undefined' && process.env) ||
  {};
export const supabaseUrl =
  env.VITE_SUPABASE_URL ||
  (typeof process !== 'undefined' && process.env.VITE_SUPABASE_URL) ||
  'http://127.0.0.1:54321';
export const supabaseAnonKey =
  env.VITE_SUPABASE_ANON_KEY ||
  (typeof process !== 'undefined' && process.env.VITE_SUPABASE_ANON_KEY) ||
  'sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH';

/**
 * Unified Singleton Supabase client instance.
 * Includes optimized realtime and auth persistence settings to prevent instance duplication.
 */
export const supabase = createClient<Database>(supabaseUrl, supabaseAnonKey, {
  realtime: {
    params: {
      eventsPerSecond: 20, // Increased slightly for warehouse operations
    },
  },
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});
