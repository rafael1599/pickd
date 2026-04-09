import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';

/**
 * Fetches SKUs physically verified in the last 2 months.
 * Sources: cycle counts, inventory moves, and adds.
 * Returns a Map<sku, lastVerifiedDate> for quick lookup.
 */
export function useVerifiedSkus() {
  const [verifiedMap, setVerifiedMap] = useState<Map<string, Date>>(new Map());

  useEffect(() => {
    const twoMonthsAgo = new Date();
    twoMonthsAgo.setMonth(twoMonthsAgo.getMonth() - 2);
    const since = twoMonthsAgo.toISOString();

    Promise.all([
      // Cycle counts
      (supabase as any)
        .from('cycle_count_items')
        .select('sku, counted_at')
        .in('status', ['counted', 'verified'])
        .gte('counted_at', since)
        .order('counted_at', { ascending: false }),
      // Moves + Adds
      supabase
        .from('inventory_logs')
        .select('sku, created_at')
        .in('action_type', ['MOVE', 'ADD'])
        .eq('is_reversed', false)
        .gte('created_at', since)
        .order('created_at', { ascending: false }),
    ]).then(([cycleRes, moveAddRes]) => {
      const map = new Map<string, Date>();
      // Cycle counts first (higher confidence)
      ((cycleRes.data || []) as { sku: string; counted_at: string }[]).forEach((row) => {
        if (!map.has(row.sku)) {
          map.set(row.sku, new Date(row.counted_at));
        }
      });
      // Then moves/adds (fill gaps)
      ((moveAddRes.data || []) as { sku: string; created_at: string }[]).forEach((row) => {
        if (!map.has(row.sku)) {
          map.set(row.sku, new Date(row.created_at));
        }
      });
      setVerifiedMap(map);
    });
  }, []);

  return verifiedMap;
}
