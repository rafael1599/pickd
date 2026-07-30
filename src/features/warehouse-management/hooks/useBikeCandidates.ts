// The warehouse-wide candidate pool, and the bikes ruled out of it.
//
// The block-scoped list (useNoMoverList) answers "what is in ROW 28-33 and
// should it stay?". It cannot answer "what do we bring in?", and the blocks
// cannot be filled without bringing things in: their own rows hold 8 non-mover
// SKUs that reach a pallet, for 54 assignable cells.
//
// Exclusions are per SKU, not per row. Juveniles live in ROW 17 and the
// oversize models in ROW 10, but the row is only where you find them — recorded
// against the row, the exclusion would evaporate the moment a bike is moved.

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../../../lib/supabase';
import { useAuth } from '../../../context/AuthContext';

const CANDIDATES_KEY = 'warehouse-bike-candidates';
const EXCLUDED_KEY = ['warehouse-excluded-skus'];

export interface BikeCandidate {
  sku: string;
  itemName: string | null;
  totalQty: number;
  /** The cell holding most of its units — the row to pull from. */
  location: string;
  sublocation: string[] | null;
  lastShipped: string | null;
  isMover: boolean;
  /** Set when the SKU is barred from the blocks; the reason is free text. */
  excludedReason: string | null;
}

export interface ExcludedSku {
  sku: string;
  reason: string;
  updated_at: string;
  updated_by: string | null;
}

/** Every bike in the warehouse with stock, classified by shipment recency. */
export function useBikeCandidates(recencyDays: number) {
  return useQuery({
    queryKey: [CANDIDATES_KEY, recencyDays],
    queryFn: async (): Promise<BikeCandidate[]> => {
      const { data, error } = await supabase.rpc('get_bike_block_candidates', {
        p_recency_days: recencyDays,
      });
      if (error) throw new Error(`Failed to load bike candidates: ${error.message}`);

      return (data ?? []).map((r) => ({
        sku: r.sku,
        itemName: r.item_name ?? null,
        totalQty: Number(r.total_qty ?? 0),
        location: r.location ?? '',
        sublocation: r.sublocation ?? null,
        lastShipped: r.last_shipped ?? null,
        isMover: Boolean(r.is_mover),
        excludedReason: r.excluded_reason ?? null,
      }));
    },
    staleTime: 60_000,
  });
}

export function useExcludedSkus() {
  return useQuery({
    queryKey: EXCLUDED_KEY,
    queryFn: async (): Promise<ExcludedSku[]> => {
      const { data, error } = await supabase.from('warehouse_excluded_skus').select('*');
      if (error) throw new Error(`Failed to load exclusions: ${error.message}`);
      return (data ?? []) as ExcludedSku[];
    },
    staleTime: 60_000,
  });
}

/**
 * Bars SKUs from every block. Built for the bulk case: the operator filters the
 * list down to a row — ROW 17 is the juveniles, ROW 10 the oversize models —
 * selects it whole and rules it out in one action.
 */
export function useExcludeSkus() {
  const queryClient = useQueryClient();
  const { user } = useAuth();

  return useMutation({
    mutationFn: async ({ skus, reason }: { skus: string[]; reason: string }) => {
      if (skus.length === 0) return;
      const { error } = await supabase.from('warehouse_excluded_skus').upsert(
        skus.map((sku) => ({ sku, reason, updated_by: user?.email ?? null })),
        { onConflict: 'sku' }
      );
      if (error) throw new Error(`Failed to exclude: ${error.message}`);

      // An excluded SKU has no business staying on a block's list.
      const { error: cleanup } = await supabase
        .from('warehouse_no_movers')
        .delete()
        .in('sku', skus);
      if (cleanup) throw new Error(`Excluded, but failed to clear the list: ${cleanup.message}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: EXCLUDED_KEY });
      queryClient.invalidateQueries({ queryKey: [CANDIDATES_KEY] });
      queryClient.invalidateQueries({ queryKey: ['warehouse-no-movers'] });
    },
  });
}

export function useUnexcludeSkus() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (skus: string[]) => {
      if (skus.length === 0) return;
      const { error } = await supabase.from('warehouse_excluded_skus').delete().in('sku', skus);
      if (error) throw new Error(`Failed to restore: ${error.message}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: EXCLUDED_KEY });
      queryClient.invalidateQueries({ queryKey: [CANDIDATES_KEY] });
    },
  });
}
