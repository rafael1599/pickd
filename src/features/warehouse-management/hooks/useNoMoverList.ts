// Data layer for the no-mover classification screen (RF-001..006).
//
// Three concerns, all shared across users via Supabase:
//   - block settings: the criteria the manager can change (recency window,
//     minimum units, positions per row)
//   - the curated no-mover list itself
//   - the suggestions the system proposes, from stock + shipment recency
//
// The suggestions are derived, never stored: nothing is added to the list
// without the manager confirming it (RF-003).

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../../../lib/supabase';
import { useAuth } from '../../../context/AuthContext';
import { BLOCKS, type BlockConfig } from '../../../utils/dsPalletPlanner';

const SETTINGS_KEY = ['warehouse-block-settings'];
const NO_MOVERS_KEY = ['warehouse-no-movers'];

export interface BlockSettings {
  block_id: string;
  recency_days: number;
  min_units: number;
  positions_per_row: number;
  reserve_last_position: boolean;
  updated_at: string;
  updated_by: string | null;
}

export interface NoMoverEntry {
  sku: string;
  block_id: string;
  last_shipped_at: string | null;
  qty_at_decision: number | null;
  updated_at: string;
  updated_by: string | null;
}

/** One candidate row as the classification screen shows it. */
export interface ClassificationCandidate {
  sku: string;
  totalQty: number;
  location: string;
  sublocation: string[] | null;
  ordersCompleted: number;
  lastShipped: string | null;
  /** Shipped inside the recency window — the system's suggestion, not a decision. */
  isMover: boolean;
}

export function useBlockSettings() {
  return useQuery({
    queryKey: SETTINGS_KEY,
    queryFn: async (): Promise<Record<string, BlockSettings>> => {
      const { data, error } = await supabase.from('warehouse_block_settings').select('*');
      if (error) throw new Error(`Failed to load block settings: ${error.message}`);

      const byBlock: Record<string, BlockSettings> = {};
      for (const row of (data ?? []) as BlockSettings[]) byBlock[row.block_id] = row;
      return byBlock;
    },
    staleTime: 60_000,
  });
}

export function useUpdateBlockSettings() {
  const queryClient = useQueryClient();
  const { user } = useAuth();

  return useMutation({
    mutationFn: async ({
      blockId,
      ...changes
    }: Partial<Omit<BlockSettings, 'block_id' | 'updated_at' | 'updated_by'>> & {
      blockId: string;
    }) => {
      const { error } = await supabase
        .from('warehouse_block_settings')
        .update({ ...changes, updated_by: user?.email ?? null })
        .eq('block_id', blockId);
      if (error) throw new Error(`Failed to update settings: ${error.message}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: SETTINGS_KEY });
    },
  });
}

export function useNoMovers() {
  return useQuery({
    queryKey: NO_MOVERS_KEY,
    queryFn: async (): Promise<NoMoverEntry[]> => {
      const { data, error } = await supabase.from('warehouse_no_movers').select('*');
      if (error) throw new Error(`Failed to load no-mover list: ${error.message}`);
      return (data ?? []) as NoMoverEntry[];
    },
    staleTime: 0,
    refetchOnWindowFocus: true,
  });
}

/**
 * Adds or moves SKUs in the list. The primary key on `sku` is what enforces
 * "one SKU, one block" — upserting to a different block moves it rather than
 * duplicating it (RF-004).
 */
export function useSetNoMovers() {
  const queryClient = useQueryClient();
  const { user } = useAuth();

  return useMutation({
    mutationFn: async (
      entries: { sku: string; blockId: string; lastShipped?: string | null; qty?: number | null }[]
    ) => {
      if (entries.length === 0) return;
      const rows = entries.map((e) => ({
        sku: e.sku,
        block_id: e.blockId,
        last_shipped_at: e.lastShipped ?? null,
        qty_at_decision: e.qty ?? null,
        updated_by: user?.email ?? null,
      }));

      const { error } = await supabase.from('warehouse_no_movers').upsert(rows);
      if (error) throw new Error(`Failed to save no-movers: ${error.message}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: NO_MOVERS_KEY });
    },
  });
}

/** Discards SKUs from the list — used both one by one and for bulk sweeps. */
export function useRemoveNoMovers() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (skus: string[]) => {
      if (skus.length === 0) return;
      const { error } = await supabase.from('warehouse_no_movers').delete().in('sku', skus);
      if (error) throw new Error(`Failed to remove no-movers: ${error.message}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: NO_MOVERS_KEY });
    },
  });
}

/**
 * Mover / no-mover suggestions for a block, straight from current stock.
 *
 * The split is by shipment recency, not order count: validated against a
 * manual classification, order count does not separate the two classes
 * (there are no-movers with 12+ orders and movers with 8), while the last
 * shipped date does.
 */
export function useBlockClassification(block: BlockConfig, recencyDays: number) {
  const rows = block.rows.map((r) => `ROW ${r}`);

  return useQuery({
    queryKey: ['warehouse-block-classification', block.id, rows, recencyDays],
    queryFn: async (): Promise<ClassificationCandidate[]> => {
      const { data, error } = await supabase.rpc('get_block_classification_candidates', {
        p_rows: rows,
        p_recency_days: recencyDays,
      });
      if (error) throw new Error(`Failed to load candidates: ${error.message}`);

      return (data ?? []).map((r) => ({
        sku: r.sku,
        totalQty: Number(r.total_qty ?? 0),
        location: r.location ?? '',
        sublocation: r.sublocation ?? null,
        ordersCompleted: Number(r.orders_completed ?? 0),
        lastShipped: r.last_shipped ?? null,
        isMover: Boolean(r.is_mover),
      }));
    },
    staleTime: 0,
    refetchOnWindowFocus: true,
  });
}

/** Settings for a block, falling back to the planner defaults if the row is missing. */
export function blockWithSettings(block: BlockConfig, settings?: BlockSettings): BlockConfig {
  if (!settings) return block;
  return {
    ...block,
    positionsPerRow: settings.positions_per_row,
    reserveLastPosition: settings.reserve_last_position,
  };
}

export function findBlock(blockId: string): BlockConfig {
  return BLOCKS.find((b) => b.id === blockId) ?? BLOCKS[0];
}
