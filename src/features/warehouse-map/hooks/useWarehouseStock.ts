// Every live line in a `ROW` location, once, for the whole map. ~360 lines
// today; one query beats one per zone, and the master map wants the totals.
// Live data: stale at once, refetched on focus, a refresh button in the view.

import { useQuery } from '@tanstack/react-query';
import { supabase } from '../../../lib/supabase';
import type { StockRow } from '../stock/rowStock';

export const WAREHOUSE_STOCK_KEY = ['warehouse-map', 'stock'] as const;

export function useWarehouseStock(enabled = true) {
  return useQuery({
    queryKey: WAREHOUSE_STOCK_KEY,
    queryFn: async (): Promise<StockRow[]> => {
      const { data, error } = await supabase
        .from('inventory')
        .select('id, sku, location, sublocation, quantity, item_name, warehouse')
        .eq('is_active', true)
        .gt('quantity', 0)
        .ilike('location', 'ROW%');
      if (error) throw new Error(`Failed to load row stock: ${error.message}`);
      return (data ?? []).map((d) => ({
        id: d.id,
        sku: d.sku,
        itemName: d.item_name ?? null,
        location: d.location ?? '',
        warehouse: d.warehouse ?? '',
        sublocation: (d.sublocation as string[] | null) ?? null,
        quantity: d.quantity ?? 0,
      }));
    },
    enabled,
    staleTime: 0,
    refetchOnWindowFocus: true,
  });
}
