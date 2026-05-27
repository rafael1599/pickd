import { useQuery } from '@tanstack/react-query';
import { supabase } from '../../../lib/supabase';

export interface LastActivity {
  sku: string;
  action_type: string;
  from_location: string | null;
  to_location: string | null;
  quantity_change: number;
  order_number: string | null;
  list_id: string | null;
  created_at: string;
}

/**
 * Fetches the most recent inventory_log entry for each SKU in the list.
 * Used to show "ghost trail" context for qty=0 items in search results.
 */
export function useLastActivity(skus: string[]) {
  return useQuery({
    queryKey: ['last-activity', skus],
    queryFn: async (): Promise<Map<string, LastActivity>> => {
      if (skus.length === 0) return new Map();

      // The previous filter `.neq('quantity_change', 0)` accidentally hid
      // legacy MOVE logs that emit Shape A (qc=0, prev=new=N — see
      // docs/inventory-log-shapes.md). Those moves did relocate stock,
      // they just chose a row-state-centric audit shape. Filter only by
      // action_type and is_reversed so the ghost trail keeps tracking them.
      const { data, error } = await supabase
        .from('inventory_logs')
        .select(
          'sku, action_type, from_location, to_location, quantity_change, order_number, list_id, created_at'
        )
        .in('sku', skus)
        .in('action_type', ['MOVE', 'DEDUCT', 'ADD', 'DELETE'])
        .eq('is_reversed', false)
        .order('created_at', { ascending: false });

      if (error) throw error;

      // Keep only the most recent entry per SKU
      const map = new Map<string, LastActivity>();
      for (const row of data ?? []) {
        if (!map.has(row.sku)) {
          map.set(row.sku, row as LastActivity);
        }
      }
      return map;
    },
    enabled: skus.length > 0,
    staleTime: 2 * 60_000,
  });
}

/** Format a LastActivity into a human-readable one-liner */
export function formatLastActivity(activity: LastActivity): string {
  const date = new Date(activity.created_at).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  });

  const from = activity.from_location ? ` from ${activity.from_location}` : '';
  switch (activity.action_type) {
    case 'MOVE':
      return `Moved${from} to ${activity.to_location || '?'} · ${date}`;
    case 'DEDUCT':
      if (activity.order_number) {
        return `Shipped${from} in #${activity.order_number} · ${date}`;
      }
      return `Deducted ${Math.abs(activity.quantity_change)} units${from} · ${date}`;
    case 'ADD':
      return `Received at ${activity.to_location || activity.from_location || '?'} · ${date}`;
    case 'DELETE':
      return `Deleted${from} · ${date}`;
    default:
      return `${activity.action_type} · ${date}`;
  }
}
