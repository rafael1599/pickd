import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../../../lib/supabase';
import { useAuth } from '../../../context/AuthContext';
import {
  computeOverstockPlan,
  type RankedCandidate,
  type OverstockLayoutPlanResult,
} from './useOverstockLayoutPlan';
import { type RankingWeights } from '../../../utils/overstockPutaway';

export interface PersistedWarehousePlanRecord {
  id: string;
  warehouse: string;
  plan_data: {
    slots: OverstockLayoutPlanResult['plan']['slots'];
    /** Units that did not fit. Previously computed and then dropped on save. */
    unplaced: OverstockLayoutPlanResult['plan']['unplaced'];
  };
  ranking_weights: RankingWeights;
  effectively_excluded_skus: string[];
  updated_at: string;
  updated_by: string | null;
}

const PLAN_ID = 'LUDLOW_OVERSTOCK';

/**
 * Fast O(1) query — loads the pre-calculated, saved warehouse map layout
 * directly from Supabase without running heavy database scans.
 */
export function useWarehouseMapPersistedPlan() {
  return useQuery({
    queryKey: ['warehouse-map-persisted-plan'],
    queryFn: async (): Promise<PersistedWarehousePlanRecord | null> => {
      const { data, error } = await supabase
        .from('warehouse_overstock_plans')
        .select('*')
        .eq('id', PLAN_ID)
        .maybeSingle();

      if (error && error.code !== 'PGRST116') {
        console.warn('Error fetching persisted warehouse plan:', error);
      }

      return (data as unknown as PersistedWarehousePlanRecord) ?? null;
    },
    staleTime: 5 * 60 * 1000,
  });
}

/**
 * Mutation — Recalculates the overstock placement plan from scratch
 * using fresh inventory & sales stats, then saves the result to Supabase.
 */
export function useRecalculateWarehouseMapPlan() {
  const queryClient = useQueryClient();
  const { user } = useAuth();

  return useMutation({
    mutationFn: async ({
      pool,
      effectivelyExcludedSkus,
      rankingWeights,
      prioritySkus,
    }: {
      pool: RankedCandidate[];
      effectivelyExcludedSkus: ReadonlySet<string>;
      rankingWeights: RankingWeights;
      prioritySkus: ReadonlySet<string>;
    }) => {
      // 1. Compute new layout plan
      const computed = computeOverstockPlan(
        pool,
        effectivelyExcludedSkus,
        rankingWeights,
        prioritySkus
      );

      // 2. Persist to Supabase database
      const record = {
        id: PLAN_ID,
        warehouse: 'LUDLOW',
        plan_data: {
          slots: computed.plan.slots,
          unplaced: computed.plan.unplaced,
        },
        ranking_weights: rankingWeights,
        effectively_excluded_skus: Array.from(effectivelyExcludedSkus),
        updated_at: new Date().toISOString(),
        updated_by: user?.email ?? 'Usuario',
      };

      const { error } = await supabase.from('warehouse_overstock_plans').upsert(record as never);

      if (error) {
        throw new Error(`Failed to save plan: ${error.message}`);
      }

      return record as unknown as PersistedWarehousePlanRecord;
    },
    onSuccess: (newRecord) => {
      queryClient.setQueryData(['warehouse-map-persisted-plan'], newRecord);
      queryClient.invalidateQueries({ queryKey: ['warehouse-map-persisted-plan'] });
    },
  });
}
