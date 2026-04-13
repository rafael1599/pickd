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
    weight_lbs: row.sku_metadata?.weight_lbs ?? null,
    length_in: row.sku_metadata?.length_in ?? null,
    width_in: row.sku_metadata?.width_in ?? null,
    height_in: row.sku_metadata?.height_in ?? null,
  };
}

export function useLabelItems() {
  return useQuery({
    queryKey: ['label-studio-items'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('inventory')
        .select(
          'sku, item_name, location, quantity, sku_metadata(image_url, is_bike, upc, weight_lbs, length_in, width_in, height_in)'
        )
        .eq('is_active', true)
        .gt('quantity', 0)
        .order('location')
        .order('sku');

      if (error) throw error;
      return ((data ?? []) as unknown as RawRow[]).map(flattenRow);
    },
    staleTime: 5 * 60_000,
  });
}
