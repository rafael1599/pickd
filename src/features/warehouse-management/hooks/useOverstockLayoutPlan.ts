import { useQuery } from '@tanstack/react-query';
import { supabase } from '../../../lib/supabase';
import {
  computeOverstockPlan as computeOverstockPlanPure,
  DEFAULT_RANKING_WEIGHTS,
  type OverstockCandidate,
  type OverstockPlanComputation,
  type RankingWeights,
} from '../../../utils/overstockPutaway';

// Trailing window for "how much has this SKU moved" — fixed, not relaxed.
const MONTHS = 12;
// Starting point for what counts as Overstock (docs/overstock-putaway-plan.md).
// Not a hard cutoff: goal #1 is filling the block, so the candidate pool
// includes every bike SKU sorted least-moved-first, and the greedy placement
// only reaches past this baseline as far as it needs to fill the remaining
// space. These are just what we report back as "how far we had to loosen."
const BASELINE_MAX_ORDERS = 12;
const BASELINE_MIN_QTY = 3;

export interface RankedCandidate extends OverstockCandidate {
  itemName: string | null;
  ordersCompleted: number;
  lastShipped: string | null;
  pullFrom: string;
  weightLbs: number | null;
}

/** Network fetch + ranking only — cheap to re-derive a plan from this without re-querying. */
export function useOverstockCandidatePool() {
  return useQuery({
    queryKey: ['warehouse-map-overstock-candidates'],
    queryFn: async (): Promise<RankedCandidate[]> => {
      // 1. All active LUDLOW bike inventory, paged past PostgREST's 1k row cap.
      type InvRow = {
        sku: string;
        quantity: number;
        location: string | null;
        sublocation: string[] | null;
        item_name: string | null;
        sku_metadata: { is_bike: boolean | null; weight_lbs: number | null } | null;
      };
      for (let from = 0; ; from += 1000) {
        const { data: page, error } = await supabase
          .from('inventory')
          .select(
            'sku, quantity, location, sublocation, item_name, sku_metadata(is_bike, weight_lbs)'
          )
          .eq('is_active', true)
          .gt('quantity', 0)
          .eq('warehouse', 'LUDLOW')
          .range(from, from + 999);
        if (error) throw error;
        inv.push(...((page ?? []) as unknown as InvRow[]));
        if (!page || page.length < 1000) break;
      }
      const bikes = inv.filter((r) => r.sku_metadata?.is_bike === true);

      // 2. Aggregate qty per SKU + where it currently lives (for "pull from").
      const totals = new Map<
        string,
        {
          qty: number;
          itemName: string | null;
          sources: Map<string, number>;
          weightLbs: number | null;
        }
      >();
      for (const r of bikes) {
        const e = totals.get(r.sku) ?? {
          qty: 0,
          itemName: r.item_name,
          sources: new Map<string, number>(),
          weightLbs: r.sku_metadata?.weight_lbs ?? null,
        };
        e.qty += r.quantity;
        const sourceLabel = r.sublocation?.length
          ? `${r.location ?? '?'} (${r.sublocation.join('/')})`
          : (r.location ?? 'Unknown');
        e.sources.set(sourceLabel, (e.sources.get(sourceLabel) ?? 0) + r.quantity);
        totals.set(r.sku, e);
      }
      const skus = [...totals.keys()];
      if (!skus.length) return [];

      // 3. Rename-aware order stats for the trailing window.
      const since = new Date();
      since.setMonth(since.getMonth() - MONTHS);
      const stats = new Map<string, { orders: number; lastShipped: string | null }>();
      for (let i = 0; i < skus.length; i += 200) {
        const { data: st, error } = await supabase.rpc('get_sku_movement_stats_batch', {
          p_skus: skus.slice(i, i + 200),
          p_since: since.toISOString(),
        });
        if (error) throw error;
        for (const s of st ?? []) {
          stats.set(s.sku, {
            orders: Number(s.orders_completed) || 0,
            lastShipped: s.last_shipped ?? null,
          });
        }
      }

      // 4. Full candidate pool (no hard filter). Ranking by weighted score
      // happens client-side in computeOverstockPlan, so weight sliders don't
      // need a refetch.
      const candidates: RankedCandidate[] = [];
      for (const [sku, { qty, itemName, sources, weightLbs }] of totals) {
        const s = stats.get(sku) ?? { orders: 0, lastShipped: null };
        const pullFrom = [...sources.entries()]
          .sort((a, b) => b[1] - a[1])
          .map(([label, qtyAtSource]) => `${label}: ${qtyAtSource}u`)
          .join(', ');
        candidates.push({
          sku,
          totalQty: qty,
          itemName,
          ordersCompleted: s.orders,
          lastShipped: s.lastShipped,
          pullFrom,
          weightLbs,
        });
      }

      return candidates;
    },
    staleTime: 5 * 60 * 1000,
  });
}

export type OverstockLayoutPlanResult = OverstockPlanComputation<RankedCandidate>;

export function computeOverstockPlan(
  pool: RankedCandidate[],
  excludedSkus: ReadonlySet<string>,
  weights: RankingWeights = DEFAULT_RANKING_WEIGHTS,
  pinnedSkus: ReadonlySet<string> = new Set()
): OverstockLayoutPlanResult {
  return computeOverstockPlanPure(
    pool,
    excludedSkus,
    { maxOrders: BASELINE_MAX_ORDERS, minQty: BASELINE_MIN_QTY },
    weights,
    pinnedSkus
  );
}
