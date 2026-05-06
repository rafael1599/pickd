import { useQuery } from '@tanstack/react-query';
import { supabase } from '../../../lib/supabase';
import { getNYDayBounds } from '../../../lib/nyDate';
import type { FedExReturnSummary } from './useActivityReport';

/**
 * Returns FedEx returns received in the 7-day window ending on `date`
 * (inclusive). Same minimal shape as the day-scoped block — no names, no
 * timestamps. Disabled until `enabled` is true so the query only fires when
 * the operator toggles the checkbox in the report editor.
 */
export function useFedExReturnsWeekly(date: string, enabled: boolean) {
  return useQuery({
    queryKey: ['fedex-returns-weekly', date],
    queryFn: async (): Promise<FedExReturnSummary[]> => {
      // Anchor on the same NY-day end the daily report uses, then walk 7
      // days back via the same helper so DST shifts don't lose an hour.
      const { endsAt: dayEnd } = await getNYDayBounds(date);
      const sevenDaysAgoIso = (() => {
        const d = new Date(dayEnd);
        d.setDate(d.getDate() - 7);
        return d.toISOString();
      })();

      const { data, error } = await supabase
        .from('fedex_returns')
        .select('tracking_number, status, items:fedex_return_items(quantity)')
        .gte('received_at', sevenDaysAgoIso)
        .lte('received_at', dayEnd)
        .order('received_at', { ascending: false })
        .limit(500);
      if (error) throw error;

      type Row = {
        tracking_number: string | null;
        status: string | null;
        items: { quantity: number | null }[] | null;
      };
      return (data as unknown as Row[]).map((r) => {
        const items = r.items ?? [];
        return {
          tracking_number: r.tracking_number ?? '—',
          status: r.status ?? 'unknown',
          item_count: items.length,
          total_qty: items.reduce((sum, it) => sum + (Number(it.quantity) || 0), 0),
        };
      });
    },
    enabled: enabled && !!date,
    staleTime: 2 * 60_000,
    retry: 1,
  });
}
