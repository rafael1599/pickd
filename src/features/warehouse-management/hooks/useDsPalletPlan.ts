// Bridges the DS-Pallet planner with its persisted plan (RF-015, RNF-004).
//
// Each block keeps its own row in warehouse_overstock_plans, with its own
// timestamp and its own recalculation. Plans written by the old tower/line
// model carry a lower plan_version and are ignored rather than migrated —
// the first recalculation reassigns nearly everything anyway, so migrating
// would invent a precision the data does not have.

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../../../lib/supabase';
import { useAuth } from '../../../context/AuthContext';
import {
  PLAN_VERSION,
  fitMinimum,
  palletsAt,
  planBlock,
  type BlockConfig,
  type BlockPlan,
  type CurrentPlacement,
  type NoMoverCandidate,
  type PalletSlot,
  type PullFirstEntry,
} from '../../../utils/dsPalletPlanner';
import { useNoMovers, type NoMoverEntry } from './useNoMoverList';

export interface PersistedDsPalletPlan {
  id: string;
  block_id: string;
  plan_version: number;
  /** `minUnits` records what the plan was fitted to, so Pull First can name the
   *  threshold a leftover actually missed. Absent on plans saved before it. */
  plan_data: { slots: PalletSlot[]; minUnits?: number };
  pull_first: PullFirstEntry[];
  updated_at: string;
  updated_by: string | null;
}

const planId = (blockId: string) => `LUDLOW_DSP_${blockId}`;
const planKey = (blockId: string) => ['ds-pallet-plan', blockId];

export interface PlanQueryResult {
  /** Null when there is no plan this code can read. */
  plan: PersistedDsPalletPlan | null;
  /** The version found when a row exists but predates the current model. */
  staleVersion: number | null;
}

/**
 * The saved plan for a block. A stale plan_version is not rendered — the cells
 * would come from a model that no longer exists — but it is reported instead of
 * being flattened into "no plan", because "recalculate to upgrade this" and
 * "nothing was ever saved" are different things to tell the operator.
 */
export function useDsPalletPlan(blockId: string) {
  return useQuery({
    queryKey: planKey(blockId),
    queryFn: async (): Promise<PlanQueryResult> => {
      const { data, error } = await supabase
        .from('warehouse_overstock_plans')
        .select('*')
        .eq('id', planId(blockId))
        .maybeSingle();

      if (error && error.code !== 'PGRST116') {
        throw new Error(`Failed to load plan: ${error.message}`);
      }
      if (!data) return { plan: null, staleVersion: null };

      const record = data as unknown as PersistedDsPalletPlan;
      if (record.plan_version !== PLAN_VERSION) {
        return { plan: null, staleVersion: record.plan_version };
      }
      return { plan: record, staleVersion: null };
    },
    staleTime: 60_000,
  });
}

/**
 * Turns the curated list into planner input: how much of each SKU exists and
 * which cells it already occupies, so anchoring can be honoured.
 *
 * Quantity is counted across the whole warehouse, not just the block — a
 * no-mover living somewhere else is exactly the case RF-013 covers, and its
 * stock has to be placed too.
 */
export function useDsPalletCandidates(block: BlockConfig) {
  const { data: noMovers } = useNoMovers();
  const mine = (noMovers ?? []).filter((n: NoMoverEntry) => n.block_id === block.id);
  const skus = mine.map((n) => n.sku);

  return useQuery({
    queryKey: ['ds-pallet-candidates', block.id, skus],
    enabled: skus.length > 0,
    queryFn: async (): Promise<NoMoverCandidate[]> => {
      const { data, error } = await supabase
        .from('inventory')
        .select('sku, location, sublocation, quantity')
        .in('sku', skus)
        .eq('is_active', true)
        .gt('quantity', 0);

      if (error) throw new Error(`Failed to load stock: ${error.message}`);

      const totals = new Map<string, number>();
      const placements = new Map<string, CurrentPlacement[]>();

      for (const row of data ?? []) {
        const qty = Number(row.quantity ?? 0);
        totals.set(row.sku, (totals.get(row.sku) ?? 0) + qty);

        const rowName = (row.location ?? '').replace(/^ROW\s+/i, '');
        // A legacy record can span several letters (the old double slots).
        // Only the first anchors — one cell now holds one pallet.
        const letter = row.sublocation?.[0];
        if (!rowName || !letter) continue;

        const list = placements.get(row.sku) ?? [];
        list.push({ row: rowName, letter, units: qty });
        placements.set(row.sku, list);
      }

      return skus.map((sku) => ({
        sku,
        totalQty: totals.get(sku) ?? 0,
        blockId: block.id,
        currentPlacements: placements.get(sku) ?? [],
      }));
    },
    staleTime: 0,
  });
}

export interface RecalculatedPlan extends BlockPlan {
  /** What the planner actually ran with, after fitting. */
  minUnits: number;
  /** Set when fitting had to go below the configured minimum to fill the block. */
  fittedFrom: number | null;
  /** False when no minimum fills the block — the list is simply too short. */
  fills: boolean;
}

/**
 * Runs the planner and saves the result for one block.
 *
 * The minimum is fitted rather than obeyed: an empty cell is worse than a
 * pallet of 17 instead of 20, so the planner runs at the highest minimum that
 * still fills the block. It never goes lower than it has to, and when nothing
 * fills it leaves the configured minimum alone so the shortfall stays visible.
 */
export function useRecalculateDsPalletPlan() {
  const queryClient = useQueryClient();
  const { user } = useAuth();

  return useMutation({
    mutationFn: async ({
      block,
      candidates,
      minUnits,
      autoFit = true,
      skuCapacityOverrides,
    }: {
      block: BlockConfig;
      candidates: NoMoverCandidate[];
      minUnits: number;
      autoFit?: boolean;
      skuCapacityOverrides?: Record<string, number>;
    }): Promise<RecalculatedPlan> => {
      const fit = autoFit
        ? fitMinimum(candidates, block, minUnits)
        : { minUnits, pallets: palletsAt(candidates, minUnits), cells: 0, fills: true };

      const plan = planBlock(block, candidates, {
        minUnits: fit.minUnits,
        skuCapacityOverrides,
      });

      const { error } = await supabase.from('warehouse_overstock_plans').upsert({
        id: planId(block.id),
        block_id: block.id,
        warehouse: 'LUDLOW',
        plan_version: plan.planVersion,
        plan_data: { slots: plan.slots, minUnits: fit.minUnits, skuCapacityOverrides } as never,
        pull_first: plan.pullFirst as never,
        // Carried over from the previous model; unused by the DS-Pallet planner.
        ranking_weights: {} as never,
        updated_at: new Date().toISOString(),
        updated_by: user?.email ?? null,
      });

      if (error) throw new Error(`Failed to save plan: ${error.message}`);
      return {
        ...plan,
        minUnits: fit.minUnits,
        fittedFrom: fit.minUnits < minUnits ? minUnits : null,
        fills: fit.fills,
      };
    },
    onSuccess: (_plan, { block }) => {
      queryClient.invalidateQueries({ queryKey: planKey(block.id) });
    },
  });
}
