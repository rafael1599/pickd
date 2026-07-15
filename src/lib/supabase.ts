import { createClient } from '@supabase/supabase-js';
import type { Database } from '../integrations/supabase/types';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Supabase URL and Anon Key must be provided in environment variables');
}

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
