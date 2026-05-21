import { useQuery } from '@tanstack/react-query';
import { supabase } from '../../../lib/supabase';
import { slotsToRpcInput } from './slotsToRpcInput';
import type { SlotGroup } from './types';

/**
 * Calls `get_slot_fill_candidates`. Builds the RPC input by
 * collapsing same-SKU groups into aggregated pseudo-slots so the
 * server-side ranking sees the right qty range per group.
 */

export interface CandidateRow {
  slot_id: string;
  sku: string;
  item_name: string | null;
  current_row: string;
  current_qty: number;
  velocity_score: number;
  orders_30d: number;
  orders_90d: number;
  units_30d: number;
  units_90d: number;
  last_shipped: string | null;
  fit_precision: number;
}

interface Args {
  groups: SlotGroup[];
  onlyBikes?: boolean;
  excludeActiveRows?: string[];
  topNPerSlot?: number;
}

export function useSlotFillCandidates({
  groups,
  onlyBikes = true,
  excludeActiveRows,
  topNPerSlot = 5,
}: Args) {
  const slots = slotsToRpcInput(groups);

  return useQuery({
    queryKey: ['slot-fill-candidates', slots, onlyBikes, excludeActiveRows ?? null, topNPerSlot],
    // Skip the RPC when there's nothing to fill — saves a round-trip
    // while the operator is still building groups.
    enabled: slots.length > 0,
    queryFn: async (): Promise<CandidateRow[]> => {
      const { data, error } = await supabase.rpc('get_slot_fill_candidates', {
        p_slots: slots as unknown as never,
        p_only_bikes: onlyBikes,
        ...(excludeActiveRows ? { p_exclude_active_rows: excludeActiveRows } : {}),
        p_top_n_per_slot: topNPerSlot,
      } as never);
      if (error) throw error;
      return (data ?? []) as unknown as CandidateRow[];
    },
    // Keep results around briefly — the operator may toggle a slot
    // and re-query immediately; we'd rather show the previous result
    // than a flash of "Loading".
    staleTime: 15_000,
  });
}
