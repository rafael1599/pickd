/**
 * The bikes still on hand, ranked by how often they were ordered.
 *
 * One RPC call, no pagination: the ranking is 264 rows and shrinks as boxes get
 * measured. That is small enough to hand the gap rule to the client, which is
 * the point -- see `utils/measureQueue.ts`.
 *
 * The queue is a report, not a live board, so it does not refetch on focus: the
 * order history behind it moves by the day, and a list that re-sorts itself
 * while somebody is walking it with a tape measure would lose their place.
 * Measuring a box is what changes it, and that is handled locally by the screen
 * so the card stays put and shows what was just saved.
 */
import { useQuery } from '@tanstack/react-query';
import { supabase } from '../../../lib/supabase';
import { toMeasureQueue, type BikeDemandRow, type MeasureQueueEntry } from '../utils/measureQueue';

/** Rafael, 1 sep 2026: the last twelve months, and at least three on the shelf. */
export const MEASURE_QUEUE_MONTHS = 12;
export const MEASURE_QUEUE_MIN_STOCK = 3;

export const measureQueueKey = ['fedex-dimensions', 'measure-queue'] as const;

export interface MeasureQueue {
  /** Bikes with no usable carton, most ordered first. */
  entries: MeasureQueueEntry[];
  /** Every bike the ranking considered, measured or not. */
  ranked: number;
}

export function useMeasureQueue() {
  return useQuery<MeasureQueue>({
    queryKey: measureQueueKey,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_bike_demand_ranking', {
        p_months: MEASURE_QUEUE_MONTHS,
        p_min_stock: MEASURE_QUEUE_MIN_STOCK,
      });
      if (error) throw error;
      const rows = (data ?? []) as BikeDemandRow[];
      return { entries: toMeasureQueue(rows), ranked: rows.length };
    },
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
  });
}
