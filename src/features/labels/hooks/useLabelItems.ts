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

export function useLabelItems() {
  return useQuery({
    // v2: added model/size/serial_number — bumped so the IDB-persisted cache
    // (which lacks those fields) doesn't hydrate stale rows.
    queryKey: ['label-studio-items', 'v2'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('inventory')
        .select(
          'sku, item_name, location, quantity, sku_metadata(image_url, is_bike, upc, color, model, size, serial_number, weight_lbs, length_in, width_in, height_in)'
        )
        .eq('is_active', true)
        .order('quantity', { ascending: false })
        .order('location')
        .order('sku');

      if (error) throw error;
      return ((data ?? []) as unknown as RawRow[]).map(flattenRow);
    },
    staleTime: 5 * 60_000,
  });
}
