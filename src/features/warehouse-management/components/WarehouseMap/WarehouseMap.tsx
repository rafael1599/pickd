import React, { useMemo, useState } from 'react';
import { RotateCw, Loader2 } from 'lucide-react';
import { WarehouseGrid } from './WarehouseGrid';
import { WarehouseMapFilters } from './WarehouseMapFilters';
import { SkuDetailPanel, type SelectedSku, type SkuDetailInfo } from './SkuDetailPanel';
import { ExcludedItemsSummary } from './ExcludedItemsSummary';
import {
  useOverstockCandidatePool,
  computeOverstockPlan,
} from '../../hooks/useOverstockLayoutPlan';
import { useSkuOverrides } from '../../hooks/useSkuOverrides';
import { useWeightRangeFilter } from '../../hooks/useWeightRangeFilter';
import { useRankingWeights } from '../../hooks/useRankingWeights';
import { usePrioritySkus } from '../../hooks/usePrioritySkus';
import { defaultExclusionReason, type DefaultExclusionReason } from '../../utils/defaultExclusions';

export type AutoExclusionReason = DefaultExclusionReason | 'weight';

export const WarehouseMap: React.FC = () => {
  const [rotation, setRotation] = useState(0);
  const [selectedSku, setSelectedSku] = useState<SelectedSku | null>(null);
  const { data: pool, isLoading, isError } = useOverstockCandidatePool();
  const { overrides, setOverride, clearAll: clearOverrides } = useSkuOverrides();
  const { range: weightRange, setRange: setWeightRange } = useWeightRangeFilter();
  const { weights: rankingWeights, setWeights: setRankingWeights } = useRankingWeights();
  const {
    prioritySkus,
    toggle: togglePriority,
    add: addPriority,
    remove: removePriority,
  } = usePrioritySkus();

  // Automatic exclusion rules — default model families + weight range.
  // Individually overridable per-SKU via useSkuOverrides.
  const autoExclusionReasons = useMemo(() => {
    const map = new Map<string, AutoExclusionReason>();
    for (const c of pool ?? []) {
      const modelReason = defaultExclusionReason(c.itemName);
      if (modelReason) {
        map.set(c.sku, modelReason);
        continue;
      }
      if (c.weightLbs == null) continue;
      if (weightRange.min != null && c.weightLbs < weightRange.min) map.set(c.sku, 'weight');
      else if (weightRange.max != null && c.weightLbs > weightRange.max) map.set(c.sku, 'weight');
    }
    return map;
  }, [pool, weightRange]);

  const effectivelyExcludedSkus = useMemo(() => {
    const set = new Set<string>();
    for (const c of pool ?? []) {
      // Pinned SKUs bypass exclusion — someone explicitly decided this needs a slot now.
      if (prioritySkus.has(c.sku)) continue;
      const override = overrides.get(c.sku);
      const excluded = override != null ? !override : autoExclusionReasons.has(c.sku);
      if (excluded) set.add(c.sku);
    }
    return set;
  }, [pool, autoExclusionReasons, overrides, prioritySkus]);

  const data = useMemo(
    () =>
      pool
        ? computeOverstockPlan(pool, effectivelyExcludedSkus, rankingWeights, prioritySkus)
        : undefined,
    [pool, effectivelyExcludedSkus, rankingWeights, prioritySkus]
  );

  const skuInfo = useMemo(() => {
    const map = new Map<string, SkuDetailInfo>();
    for (const c of data?.candidates ?? []) {
      map.set(c.sku, {
        itemName: c.itemName,
        pullFrom: c.pullFrom,
        ordersCompleted: c.ordersCompleted,
        totalQty: c.totalQty,
      });
    }
    return map;
  }, [data]);

  return (
    <div className="w-full h-full flex flex-col p-6 print:p-0 overflow-auto print:overflow-visible bg-white">
      {/* Header */}
      <div className="print:hidden flex flex-col md:flex-row justify-between items-start md:items-center mb-8 gap-4">
        <h2 className="text-2xl font-bold text-slate-800">Warehouse Top View</h2>

        <div className="flex items-center gap-4">
          <WarehouseMapFilters
            pool={pool ?? []}
            autoExclusionReasons={autoExclusionReasons}
            effectivelyExcludedSkus={effectivelyExcludedSkus}
            onToggleSku={(sku) => setOverride(sku, effectivelyExcludedSkus.has(sku))}
            onClearOverrides={clearOverrides}
            weightRange={weightRange}
            onWeightRangeChange={setWeightRange}
            rankingWeights={rankingWeights}
            onRankingWeightsChange={setRankingWeights}
            prioritySkus={prioritySkus}
            onTogglePriority={togglePriority}
            onAddPriority={addPriority}
            onRemovePriority={removePriority}
          />

          <button
            onClick={() => setRotation((prev) => prev + 90)}
            className="flex items-center justify-center w-10 h-10 rounded-lg border border-gray-200 bg-white text-slate-600 shadow-sm hover:bg-gray-50 hover:text-slate-800 transition-colors"
            title="Rotate 90°"
          >
            <RotateCw className="w-5 h-5" />
          </button>
        </div>
      </div>

      <ExcludedItemsSummary
        pool={pool ?? []}
        autoExclusionReasons={autoExclusionReasons}
        effectivelyExcludedSkus={effectivelyExcludedSkus}
      />

      {/* Map Container */}
      <div className="relative flex-1 rounded-2xl print:rounded-none bg-[#F8FAFC] print:bg-white border-2 print:border-0 border-dashed border-slate-200 p-8 print:p-0 overflow-auto print:overflow-visible">
        {isLoading ? (
          <div className="flex items-center justify-center h-full text-slate-400 gap-2">
            <Loader2 className="w-5 h-5 animate-spin" /> Loading overstock plan…
          </div>
        ) : isError ? (
          <div className="flex items-center justify-center h-full text-red-500 text-sm font-medium">
            Failed to load overstock plan.
          </div>
        ) : (
          <div className="flex justify-center items-center min-w-max mx-auto h-full print:h-auto">
            <WarehouseGrid
              slots={data?.plan.slots ?? []}
              rotation={rotation}
              onSelectSku={setSelectedSku}
            />
          </div>
        )}

        {selectedSku && (
          <SkuDetailPanel
            selected={selectedSku}
            info={skuInfo.get(selectedSku.sku)}
            onClose={() => setSelectedSku(null)}
          />
        )}
      </div>
    </div>
  );
};
