import { createClient } from '@supabase/supabase-js';

/**
 * Anon-key Supabase client for public, no-session routes (e.g. /order/:id,
 * /s/:sku, /tag/:shortCode/:token). RLS on the underlying tables is
 * authenticated-only, so these pages only ever read via SECURITY DEFINER
 * RPCs (get_public_order, get_public_tag, get_public_tag_by_sku) — never a
 * direct table select, which RLS would silently return zero rows for anyway.
 */
export const publicSupabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY
);
