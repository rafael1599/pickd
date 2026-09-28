import type { QueryClient } from '@tanstack/react-query';
import { supabase } from '../../../lib/supabase';
import { inventoryApi } from '../api/inventoryApi';
import { INVENTORY_ROOT_KEY } from './useInventoryRealtime';
import type { InventoryItemWithMetadata } from '../../../schemas/inventory.schema';

/** First page of the Stock list; "Load more" asks for the next ones. */
export const INITIAL_PAGE_SIZE = 50;

export function mapItem(item: InventoryItemWithMetadata): InventoryItemWithMetadata {
  return {
    ...item,
    location: (item.location || '').trim().toUpperCase(),
    warehouse: item.warehouse || 'LUDLOW',
  };
}

export const bikesListKey = (showInactive: boolean) => [...INVENTORY_ROOT_KEY, showInactive];

/**
 * The server's bike count lives in the cache, not in component state, so the
 * list can be fetched before the Stock screen mounts and still say how many
 * there are.
 */
export const bikesTotalKey = (showInactive: boolean) => ['inventory', 'bikes-total', showInactive];

export const bikesListQueryOptions = (queryClient: QueryClient, showInactive: boolean) => ({
  queryKey: bikesListKey(showInactive),
  queryFn: async (): Promise<InventoryItemWithMetadata[]> => {
    const { data, count } = await inventoryApi.fetchInventoryWithMetadata({
      includeInactive: showInactive,
      showParts: false,
      warehouse: 'LUDLOW',
      limit: INITIAL_PAGE_SIZE,
    });
    queryClient.setQueryData(bikesTotalKey(showInactive), count);
    return data.map(mapItem);
  },
  staleTime: Infinity,
  refetchOnWindowFocus: false,
});

export interface InventoryStats {
  totalSkus: number;
  totalQuantity: number;
  totalCapacity: number;
}

export const inventoryStatsQueryOptions = (showParts: boolean) => ({
  queryKey: ['inventory', 'stats', showParts],
  queryFn: async (): Promise<InventoryStats> => {
    const { data, error } = await supabase.rpc('get_inventory_stats', {
      p_include_parts: showParts,
    });
    if (error) throw error;
    const row = data?.[0];
    return {
      totalSkus: Number(row?.total_skus ?? 0),
      totalQuantity: Number(row?.total_units ?? 0),
      totalCapacity: Number(row?.total_capacity ?? 0),
    };
  },
  staleTime: 60_000,
  refetchOnWindowFocus: false,
});

/**
 * Starts what Stock paints first — the bike list and the totals, with the
 * screen's default filters — while its code is still downloading, instead of
 * after it mounts. Fresh cached data is left alone.
 */
export function prefetchStock(queryClient: QueryClient): void {
  void queryClient.prefetchQuery(bikesListQueryOptions(queryClient, false));
  void queryClient.prefetchQuery(inventoryStatsQueryOptions(false));
}
