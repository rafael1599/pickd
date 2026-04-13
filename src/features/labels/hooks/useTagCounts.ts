import { useQuery } from '@tanstack/react-query';
import { supabase } from '../../../lib/supabase';

export function useTagCounts() {
  return useQuery({
    queryKey: ['asset-tag-counts'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('asset_tags')
        .select('sku')
        .in('status', ['printed', 'in_stock', 'allocated', 'picked']);

      if (error) throw error;

      const counts = new Map<string, number>();
      for (const row of data ?? []) {
        counts.set(row.sku, (counts.get(row.sku) ?? 0) + 1);
      }
      return counts;
    },
    staleTime: 2 * 60_000,
  });
}
