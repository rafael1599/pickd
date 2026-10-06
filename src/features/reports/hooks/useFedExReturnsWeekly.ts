import { useQuery } from '@tanstack/react-query';
import { getNYDayBounds } from '../../../lib/nyDate';
import type { FedExReturnSummary } from './useActivityReport';
import { fetchReturnsReceived } from './returnsReceived';

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

      return fetchReturnsReceived(sevenDaysAgoIso, dayEnd, 500);
    },
    enabled: enabled && !!date,
    staleTime: 2 * 60_000,
    retry: 1,
  });
}
