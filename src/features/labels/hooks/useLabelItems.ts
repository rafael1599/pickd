import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '../../../lib/supabase';

export interface LabelInventoryItem {
  sku: string;
  item_name: string | null;
  location: string | null;
  quantity: number;
  image_url: string | null;
  is_bike: boolean;
  upc: string | null;
  color: string | null;
  model?: string | null;
  size?: string | null;
  serial_number?: string | null;
  weight_lbs: number | null;
  length_in: number | null;
  width_in: number | null;
  height_in: number | null;
}

interface RawRow {
  sku: string;
  item_name: string | null;
  location: string | null;
  quantity: number;
  sku_metadata: {
    image_url: string | null;
    is_bike: boolean;
    upc: string | null;
    color: string | null;
    model: string | null;
    size: string | null;
    serial_number: string | null;
    weight_lbs: number | null;
    length_in: number | null;
    width_in: number | null;
    height_in: number | null;
  } | null;
}

const ITEM_SELECT =
  'sku, item_name, location, quantity, sku_metadata(image_url, is_bike, upc, color, model, size, serial_number, weight_lbs, length_in, width_in, height_in)';

function flattenRow(row: RawRow): LabelInventoryItem {
  return {
    sku: row.sku,
    item_name: row.item_name,
    location: row.location,
    quantity: row.quantity,
    image_url: row.sku_metadata?.image_url ?? null,
    is_bike: row.sku_metadata?.is_bike ?? false,
    upc: row.sku_metadata?.upc ?? null,
    color: row.sku_metadata?.color ?? null,
    model: row.sku_metadata?.model ?? null,
    size: row.sku_metadata?.size ?? null,
    serial_number: row.sku_metadata?.serial_number ?? null,
    weight_lbs: row.sku_metadata?.weight_lbs ?? null,
    length_in: row.sku_metadata?.length_in ?? null,
    width_in: row.sku_metadata?.width_in ?? null,
    height_in: row.sku_metadata?.height_in ?? null,
  };
}

/**
 * Server-side SKU/name search (pickd-postgres skill: never download the whole
 * inventory to filter in JS). ilike on sku + item_name, small LIMIT, ranked by
 * exact SKU match → SKU prefix → quantity.
 */
export function useLabelSearch(rawQuery: string) {
  const query = rawQuery.trim();
  const [debounced, setDebounced] = useState(query);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(query), 250);
    return () => clearTimeout(t);
  }, [query]);

  const result = useQuery({
    queryKey: ['label-search', debounced],
    enabled: debounced.length >= 2,
    staleTime: 60_000,
    placeholderData: (prev) => prev,
    queryFn: async () => {
      // PostgREST .or() syntax breaks on commas/parens; ilike wildcards from the
      // user would widen the match — strip all of them from the pattern.
      const safe = debounced.replace(/[,()%_]/g, '');
      if (!safe) return [];
      const { data, error } = await supabase
        .from('inventory')
        .select(ITEM_SELECT)
        .eq('is_active', true)
        .or(`sku.ilike.%${safe}%,item_name.ilike.%${safe}%`)
        .order('quantity', { ascending: false })
        .limit(12);
      if (error) throw error;

      const items = ((data ?? []) as unknown as RawRow[]).map(flattenRow);
      const q = safe.toUpperCase();
      items.sort((a, b) => {
        const aExact = a.sku.toUpperCase() === q ? 1 : 0;
        const bExact = b.sku.toUpperCase() === q ? 1 : 0;
        if (aExact !== bExact) return bExact - aExact;
        const aStarts = a.sku.toUpperCase().startsWith(q) ? 1 : 0;
        const bStarts = b.sku.toUpperCase().startsWith(q) ? 1 : 0;
        if (aStarts !== bStarts) return bStarts - aStarts;
        return b.quantity - a.quantity;
      });
      return items;
    },
  });

  return {
    results: query.length >= 2 ? (result.data ?? []) : [],
    isSearching: result.isFetching || (query.length >= 2 && query !== debounced),
  };
}

/**
 * Distinct locations for the "load a whole location" dropdown. Single tiny
 * column — the full item rows are fetched on demand per location.
 */
export function useLabelLocations() {
  return useQuery({
    queryKey: ['label-locations'],
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('inventory')
        .select('location')
        .eq('is_active', true)
        .gt('quantity', 0)
        .not('location', 'is', null);
      if (error) throw error;
      const locs = [...new Set((data ?? []).map((r) => r.location as string).filter(Boolean))];
      return locs.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    },
  });
}

/** All items in one location (server-side filter), for the Load Location flow. */
export async function fetchLabelItemsByLocation(location: string): Promise<LabelInventoryItem[]> {
  const { data, error } = await supabase
    .from('inventory')
    .select(ITEM_SELECT)
    .eq('is_active', true)
    .eq('location', location)
    .order('sku');
  if (error) throw error;
  return ((data ?? []) as unknown as RawRow[]).map(flattenRow);
}

/** One SKU with its label metadata (Edit Label navigation from Item Detail). */
export async function fetchLabelItem(sku: string): Promise<LabelInventoryItem | null> {
  const { data, error } = await supabase
    .from('inventory')
    .select(ITEM_SELECT)
    .eq('sku', sku)
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data ? flattenRow(data as unknown as RawRow) : null;
}

/** item_name lookup for a set of SKUs (History reprints). */
export async function fetchItemNames(skus: string[]): Promise<Map<string, string | null>> {
  if (skus.length === 0) return new Map();
  const { data, error } = await supabase
    .from('inventory')
    .select('sku, item_name')
    .in('sku', [...new Set(skus)]);
  if (error) throw error;
  return new Map((data ?? []).map((r) => [r.sku as string, r.item_name as string | null]));
}
