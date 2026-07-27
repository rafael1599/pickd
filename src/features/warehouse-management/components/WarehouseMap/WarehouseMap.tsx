import React, { useMemo, useState } from 'react';
import { RotateCw, Loader2, Printer, RefreshCw, CheckCircle2 } from 'lucide-react';
import { WarehouseGrid } from './WarehouseGrid';
import { WarehouseMapFilters } from './WarehouseMapFilters';
import { SkuDetailPanel, type SelectedSku, type SkuDetailInfo } from './SkuDetailPanel';
import { ExcludedItemsSummary } from './ExcludedItemsSummary';
import {
  useOverstockCandidatePool,
  computeOverstockPlan,
} from '../../hooks/useOverstockLayoutPlan';
import {
  useWarehouseMapPersistedPlan,
  useRecalculateWarehouseMapPlan,
} from '../../hooks/useWarehouseMapPersistedPlan';
import { useSkuOverrides } from '../../hooks/useSkuOverrides';
import { useWeightRangeFilter } from '../../hooks/useWeightRangeFilter';
import { useRankingWeights } from '../../hooks/useRankingWeights';
import { usePrioritySkus } from '../../hooks/usePrioritySkus';
import { defaultExclusionReason, type DefaultExclusionReason } from '../../utils/defaultExclusions';

export type AutoExclusionReason = DefaultExclusionReason | 'weight';

export const WarehouseMap: React.FC = () => {
  const [rotation, setRotation] = useState(0);
  const [selectedSku, setSelectedSku] = useState<SelectedSku | null>(null);

  // 1. Fast O(1) static plan from Supabase DB (< 20ms)
  const {
    data: savedRecord,
    isLoading: isLoadingSaved,
    isError: isErrorSaved,
  } = useWarehouseMapPersistedPlan();
  const { mutateAsync: recalculatePlan, isPending: isRecalculating } =
    useRecalculateWarehouseMapPlan();

  // 2. Heavy candidate pool query — only fetched on demand or if DB record doesn't exist yet
  const { data: pool, isLoading: isLoadingPool, refetch: fetchPool } = useOverstockCandidatePool();

  const { overrides, setOverride, clearAll: clearOverrides } = useSkuOverrides();
  const { range: weightRange, setRange: setWeightRange } = useWeightRangeFilter();
  const { weights: rankingWeights, setWeights: setRankingWeights } = useRankingWeights();
  const {
    prioritySkus,
    toggle: togglePriority,
    add: addPriority,
    remove: removePriority,
  } = usePrioritySkus();

  const handlePrintLandscape = () => {
    const style = document.createElement('style');
    style.id = 'print-landscape-override';
    style.innerHTML = '@page { size: A4 landscape !important; margin: 4mm !important; }';
    document.head.appendChild(style);

    const cleanup = () => {
      document.getElementById('print-landscape-override')?.remove();
      window.removeEventListener('afterprint', cleanup);
    };

    window.addEventListener('afterprint', cleanup, { once: true });
    window.print();
    setTimeout(cleanup, 2000);
  };

  // Automatic exclusion rules — default model families + weight range.
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
      if (prioritySkus.has(c.sku)) continue;
      const override = overrides.get(c.sku);
      const excluded = override != null ? !override : autoExclusionReasons.has(c.sku);
      if (excluded) set.add(c.sku);
    }
    return set;
  }, [pool, autoExclusionReasons, overrides, prioritySkus]);

  // Recalculate plan from fresh DB data and save to Supabase
  const handleRecalculate = async () => {
    const freshPoolResult = await fetchPool();
    const candidatePool = freshPoolResult.data ?? pool ?? [];
    await recalculatePlan({
      pool: candidatePool,
      effectivelyExcludedSkus,
      rankingWeights,
      prioritySkus,
    });
  };

  // Active slots: use saved static plan from DB if available, else live computed fallback
  const activeSlots = useMemo(() => {
    if (savedRecord?.plan_data?.slots) {
      return savedRecord.plan_data.slots;
    }
    if (pool) {
      return computeOverstockPlan(pool, effectivelyExcludedSkus, rankingWeights, prioritySkus).plan
        .slots;
    }
    return [];
  }, [savedRecord, pool, effectivelyExcludedSkus, rankingWeights, prioritySkus]);

  const skuInfo = useMemo(() => {
    const map = new Map<string, SkuDetailInfo>();
    for (const c of pool ?? []) {
      map.set(c.sku, {
        itemName: c.itemName,
        pullFrom: c.pullFrom,
        ordersCompleted: c.ordersCompleted,
        totalQty: c.totalQty,
      });
    }
    return map;
  }, [pool]);

  const isLoading = isLoadingSaved || (isRecalculating && !savedRecord);

  // Formatting last updated timestamp
  const formattedLastUpdated = useMemo(() => {
    if (!savedRecord?.updated_at) return null;
    const date = new Date(savedRecord.updated_at);
    return {
      timeStr: date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      dateStr: date.toLocaleDateString([], { month: 'short', day: 'numeric' }),
      user: savedRecord.updated_by ? savedRecord.updated_by.split('@')[0] : null,
    };
  }, [savedRecord]);

  return (
    <div className="w-full h-full flex flex-col p-6 print:p-0 overflow-auto print:overflow-visible bg-white">
      {/* Header */}
      <div className="print:hidden flex flex-col md:flex-row justify-between items-start md:items-center mb-8 gap-4">
        <div>
          <h2 className="text-2xl font-bold text-slate-800">Warehouse Top View</h2>
          {formattedLastUpdated && (
            <div className="flex items-center gap-1.5 text-xs text-slate-500 mt-1">
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
              <span>
                Saved Plan · Updated {formattedLastUpdated.dateStr} at{' '}
                {formattedLastUpdated.timeStr}
                {formattedLastUpdated.user ? ` (${formattedLastUpdated.user})` : ''}
              </span>
            </div>
          )}
        </div>

        <div className="flex items-center gap-3 flex-wrap">
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
            onClick={handleRecalculate}
            disabled={isRecalculating || isLoadingPool}
            className="flex items-center gap-1.5 px-3.5 h-10 rounded-lg border border-emerald-200 bg-emerald-50 text-emerald-700 shadow-sm hover:bg-emerald-100 active:scale-95 disabled:opacity-50 transition-all font-semibold text-xs tracking-wide"
            title="Recalculate overstock plan from database inventory & sales stats and save to database"
          >
            <RefreshCw
              className={`w-4 h-4 text-emerald-600 ${isRecalculating || isLoadingPool ? 'animate-spin' : ''}`}
            />
            <span>{isRecalculating ? 'Recalculating…' : 'Recalculate Map'}</span>
          </button>

          <button
            onClick={handlePrintLandscape}
            className="flex items-center gap-1.5 px-3.5 h-10 rounded-lg border border-gray-200 bg-white text-slate-700 shadow-sm hover:bg-gray-50 active:scale-95 transition-all font-semibold text-xs tracking-wide"
            title="Print / Save PDF (Landscape A4)"
          >
            <Printer className="w-4 h-4 text-slate-500" />
            <span>Print Landscape</span>
          </button>

          <button
            onClick={() => setRotation((prev) => prev + 90)}
            className="flex items-center justify-center w-10 h-10 rounded-lg border border-gray-200 bg-white text-slate-600 shadow-sm hover:bg-gray-50 hover:text-slate-800 transition-colors"
            title="Rotate 90°"
          >
            <RotateCw className="w-5 h-5" />
          </button>
        </div>
      </div>

      <div className="print:hidden">
        <ExcludedItemsSummary
          pool={pool ?? []}
          autoExclusionReasons={autoExclusionReasons}
          effectivelyExcludedSkus={effectivelyExcludedSkus}
        />
      </div>

      {/* Map Container */}
      <div className="relative flex-1 rounded-2xl print:rounded-none bg-[#F8FAFC] print:bg-white border-2 print:border-0 border-dashed border-slate-200 p-8 print:p-0 overflow-auto print:overflow-visible">
        {isLoading ? (
          <div className="flex items-center justify-center h-full text-slate-400 gap-2">
            <Loader2 className="w-5 h-5 animate-spin" /> Loading overstock plan…
          </div>
        ) : isErrorSaved ? (
          <div className="flex items-center justify-center h-full text-red-500 text-sm font-medium">
            Failed to load overstock plan.
          </div>
        ) : (
          <div className="flex justify-center items-center min-w-max print:min-w-0 print:w-full print:h-full mx-auto h-full print:h-auto">
            <WarehouseGrid slots={activeSlots} rotation={rotation} onSelectSku={setSelectedSku} />
          </div>
        )}

        {selectedSku && (
          <div className="print:hidden">
            <SkuDetailPanel
              selected={selectedSku}
              info={skuInfo.get(selectedSku.sku)}
              onClose={() => setSelectedSku(null)}
            />
          </div>
        )}
      </div>
    </div>
  );
};
