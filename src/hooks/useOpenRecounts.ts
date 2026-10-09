import { useMemo } from 'react';
import { useQuery, type QueryClient } from '@tanstack/react-query';
import { fetchOpenRecounts } from '../services/recount.service';
import type { RecountRequest } from '../schemas/recount.schema';

export const RECOUNT_REQUESTS_QUERY_KEY = ['recount-requests', 'open'] as const;

export function recountKey(sku: string, location: string | null | undefined): string {
  return `${sku}|${(location || '').toUpperCase().trim()}`;
}

export function invalidateRecountAndInventoryQueries(queryClient: QueryClient) {
  void queryClient.invalidateQueries({ queryKey: RECOUNT_REQUESTS_QUERY_KEY });
  void queryClient.invalidateQueries({ queryKey: ['inventory'] });
  void queryClient.invalidateQueries({ queryKey: ['audit-rows'] });
  void queryClient.invalidateQueries({ queryKey: ['inventory_logs'] });
}

export function useOpenRecounts() {
  const query = useQuery({
    queryKey: RECOUNT_REQUESTS_QUERY_KEY,
    queryFn: fetchOpenRecounts,
    staleTime: 30_000,
    refetchInterval: 60_000,
  });

  const allOpen = useMemo(() => query.data ?? [], [query.data]);
  // Only what can be counted right now: an open order holding the SKU at that
  // location means units may be in a cart (Rafael, 9 oct 2026).
  const recounts = useMemo(() => allOpen.filter((r) => !r.held_by_orders), [allOpen]);

  const openRecountsBySkuLocation = useMemo(() => toMap(recounts), [recounts]);
  // Double Check asks even when the holder is the picker's own order.
  const allOpenBySkuLocation = useMemo(() => toMap(allOpen), [allOpen]);

  return {
    ...query,
    recounts,
    openRecountsBySkuLocation,
    allOpenBySkuLocation,
    count: recounts.length,
  };
}

function toMap(rows: RecountRequest[]): Map<string, RecountRequest> {
  const map = new Map<string, RecountRequest>();
  for (const r of rows) map.set(recountKey(r.sku, r.location), r);
  return map;
}
