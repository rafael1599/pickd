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

  const recounts = query.data ?? [];

  const openRecountsBySkuLocation = useMemo(() => {
    const map = new Map<string, RecountRequest>();
    for (const r of recounts) {
      map.set(recountKey(r.sku, r.location), r);
    }
    return map;
  }, [recounts]);

  return {
    ...query,
    recounts,
    openRecountsBySkuLocation,
    count: recounts.length,
  };
}
