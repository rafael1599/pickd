import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';

/**
 * Fetches SKUs verified in cycle counts within the last 2 months.
 * Returns a Map<sku, lastCountedDate> for quick lookup.
 */
export function useVerifiedSkus() {
  const [verifiedMap, setVerifiedMap] = useState<Map<string, Date>>(new Map());

  useEffect(() => {
    const twoMonthsAgo = new Date();
    twoMonthsAgo.setMonth(twoMonthsAgo.getMonth() - 2);

    (supabase as any)
      .from('cycle_count_items')
      .select('sku, counted_at')
      .in('status', ['counted', 'verified'])
      .gte('counted_at', twoMonthsAgo.toISOString())
      .order('counted_at', { ascending: false })
      .then(({ data }: { data: any[] | null }) => {
        const map = new Map<string, Date>();
        (data || []).forEach((row: { sku: string; counted_at: string }) => {
          if (!map.has(row.sku)) {
            map.set(row.sku, new Date(row.counted_at));
          }
        });
        setVerifiedMap(map);
      });
  }, []);

  return verifiedMap;
}
