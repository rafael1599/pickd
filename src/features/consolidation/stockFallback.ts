/**
 * idea-131 — Fallback search over the FULL bike stock.
 *
 * Consolidation only searches its mode's candidate set (RPCs per mode). When the
 * operator types a query and NO candidate matches, we look the SKU up in the
 * whole bike stock via the shared `search_inventory_with_metadata` RPC
 * (idea-074: normalized, dash-insensitive, ORs across inventory + sku_metadata)
 * and show WHERE it lives, so "03398 shows nothing" stops being a dead end.
 */

import { supabase } from '../../lib/supabase';

export interface StockFallbackHit {
  key: string;
  sku: string;
  item_name: string | null;
  location: string | null;
  sublocation: string[] | null;
  quantity: number;
}

export async function searchBikeStock(query: string, limit = 15): Promise<StockFallbackHit[]> {
  const trimmed = (query ?? '').trim();
  if (!trimmed) return [];
  const { data, error } = await supabase.rpc('search_inventory_with_metadata', {
    p_search: trimmed,
    p_include_inactive: false,
    p_show_parts: false, // bikes only — consolidation moves bikes
    p_only_scratch_dent: false,
    p_only_fedex_returns: false,
    p_offset: 0,
    p_limit: limit,
  });
  if (error) throw error;

  return ((data ?? []) as Array<Record<string, unknown>>).map((row, i) => ({
    key: String(row.id ?? `${row.sku}-${row.location}-${i}`),
    sku: String(row.sku ?? ''),
    item_name: (row.item_name as string | null) ?? null,
    location: (row.location as string | null) ?? null,
    sublocation: Array.isArray(row.sublocation) ? (row.sublocation as string[]) : null,
    quantity: Number(row.quantity ?? 0),
  }));
}
