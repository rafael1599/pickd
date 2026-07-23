import React, { useMemo, useState } from 'react';
import { Filter, X, Star } from 'lucide-react';
import type { RankedCandidate } from '../../hooks/useOverstockLayoutPlan';
import type { WeightRange } from '../../hooks/useWeightRangeFilter';
import type { RankingWeights } from '../../../../utils/overstockPutaway';
import type { AutoExclusionReason } from './WarehouseMap';

interface WarehouseMapFiltersProps {
  pool: RankedCandidate[];
  /** Why the automatic rules (default model families + weight range) would exclude a SKU, before overrides. */
  autoExclusionReasons: Map<string, AutoExclusionReason>;
  /** Automatic rules + per-SKU overrides applied — drives the dimmed/excluded look. */
  effectivelyExcludedSkus: Set<string>;
  onToggleSku: (sku: string) => void;
  onClearOverrides: () => void;
  weightRange: WeightRange;
  onWeightRangeChange: (next: WeightRange) => void;
  rankingWeights: RankingWeights;
  onRankingWeightsChange: (next: RankingWeights) => void;
  /** SKUs that must be placed before anything else (see usePrioritySkus). */
  prioritySkus: Set<string>;
  onTogglePriority: (sku: string) => void;
  onAddPriority: (skus: string[]) => void;
  onRemovePriority: (sku: string) => void;
}

const REASON_LABEL: Record<AutoExclusionReason, string> = {
  'wide box': 'wide box',
  juvenile: 'juvenile',
  weight: 'weight',
};

/** Accepts how SKUs actually get pasted here (e.g. "064638bk") and normalizes
 * to the stored format ("06-4638BK") when it matches the 2-digit-prefix
 * pattern; anything else (already dashed, or a non-standard code) is just
 * uppercased and left alone. */
function normalizeSku(raw: string): string {
  const trimmed = raw.trim().toUpperCase();
  if (!trimmed) return '';
  if (/^\d{2}[A-Z0-9]+$/.test(trimmed)) {
    return `${trimmed.slice(0, 2)}-${trimmed.slice(2)}`;
  }
  return trimmed;
}

export const WarehouseMapFilters: React.FC<WarehouseMapFiltersProps> = ({
  pool,
  autoExclusionReasons,
  effectivelyExcludedSkus,
  onToggleSku,
  onClearOverrides,
  weightRange,
  onWeightRangeChange,
  rankingWeights,
  onRankingWeightsChange,
  prioritySkus,
  onTogglePriority,
  onAddPriority,
  onRemovePriority,
}) => {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [priorityInput, setPriorityInput] = useState('');

  const handleAddPriority = () => {
    const skus = priorityInput
      .split(/[\s,]+/)
      .map(normalizeSku)
      .filter(Boolean);
    if (skus.length) {
      onAddPriority(skus);
      setPriorityInput('');
    }
  };

  const rows = useMemo(() => {
    const term = search.trim().toLowerCase();
    const sorted = [...pool].sort((a, b) => a.sku.localeCompare(b.sku));
    if (!term) return sorted;
    return sorted.filter(
      (c) => c.sku.toLowerCase().includes(term) || c.itemName?.toLowerCase().includes(term)
    );
  }, [pool, search]);

  const hasWeightRange = weightRange.min != null || weightRange.max != null;
  const totalExcludedCount = effectivelyExcludedSkus.size;
  const overriddenCount = pool.filter(
    (c) => effectivelyExcludedSkus.has(c.sku) !== autoExclusionReasons.has(c.sku)
  ).length;

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 h-10 px-3 rounded-lg border border-gray-200 bg-white text-slate-600 shadow-sm hover:bg-gray-50 hover:text-slate-800 transition-colors"
        title="Filter SKUs out of this view"
      >
        <Filter className="w-4 h-4" />
        <span className="text-sm font-medium">Filters</span>
        {totalExcludedCount > 0 && (
          <span className="flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-slate-800 text-white text-[10px] font-bold">
            {totalExcludedCount}
          </span>
        )}
        {prioritySkus.size > 0 && (
          <span
            className="flex items-center gap-0.5 text-[10px] font-bold text-amber-600"
            title={`${prioritySkus.size} pinned to place first`}
          >
            <Star className="w-3 h-3 fill-amber-500 text-amber-500" />
            {prioritySkus.size}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-80 max-h-[28rem] flex flex-col bg-white rounded-lg border border-gray-200 shadow-xl z-20">
          <div className="p-3 border-b border-gray-100 flex items-center gap-2">
            <input
              autoFocus
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search SKU or name…"
              className="flex-1 text-sm px-2 py-1.5 rounded-md border border-gray-200 outline-none focus:border-slate-400"
            />
            <button
              onClick={() => setOpen(false)}
              className="p-1.5 text-slate-400 hover:text-slate-700"
              title="Close"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="p-3 border-b border-gray-100">
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-400 mb-2">
              Placement priority
            </div>
            <div className="space-y-2">
              <label className="block">
                <div className="flex items-center justify-between text-xs text-slate-500 mb-0.5">
                  <span>Prefer high stock</span>
                  <span className="font-mono">{rankingWeights.qty.toFixed(1)}</span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={3}
                  step={0.1}
                  value={rankingWeights.qty}
                  onChange={(e) =>
                    onRankingWeightsChange({ ...rankingWeights, qty: Number(e.target.value) })
                  }
                  className="w-full accent-accent"
                />
              </label>
              <label className="block">
                <div className="flex items-center justify-between text-xs text-slate-500 mb-0.5">
                  <span>Prefer least moved</span>
                  <span className="font-mono">{rankingWeights.moved.toFixed(1)}</span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={3}
                  step={0.1}
                  value={rankingWeights.moved}
                  onChange={(e) =>
                    onRankingWeightsChange({ ...rankingWeights, moved: Number(e.target.value) })
                  }
                  className="w-full accent-accent"
                />
              </label>
            </div>
          </div>

          <div className="p-3 border-b border-gray-100">
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-400 mb-2">
              Weight range (lbs)
            </div>
            <div className="flex items-center gap-2">
              <input
                type="number"
                min={0}
                value={weightRange.min ?? ''}
                onChange={(e) =>
                  onWeightRangeChange({
                    ...weightRange,
                    min: e.target.value === '' ? null : Number(e.target.value),
                  })
                }
                placeholder="Min"
                className="w-full text-sm px-2 py-1.5 rounded-md border border-gray-200 outline-none focus:border-slate-400"
              />
              <span className="text-slate-300">–</span>
              <input
                type="number"
                min={0}
                value={weightRange.max ?? ''}
                onChange={(e) =>
                  onWeightRangeChange({
                    ...weightRange,
                    max: e.target.value === '' ? null : Number(e.target.value),
                  })
                }
                placeholder="Max"
                className="w-full text-sm px-2 py-1.5 rounded-md border border-gray-200 outline-none focus:border-slate-400"
              />
              {hasWeightRange && (
                <button
                  onClick={() => onWeightRangeChange({ min: null, max: null })}
                  className="p-1.5 text-slate-400 hover:text-slate-700 shrink-0"
                  title="Clear weight range"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>
            <p className="text-[11px] text-slate-400 mt-1">
              SKUs outside this range, or matching a default-excluded model family (wide box /
              juvenile), are excluded below — untick to bring one back in.
            </p>
          </div>

          <div className="p-3 border-b border-gray-100">
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-400 mb-2 flex items-center gap-1.5">
              <Star className="w-3.5 h-3.5 fill-amber-500 text-amber-500" />
              Priority (place first)
            </div>
            <div className="flex items-center gap-2">
              <input
                value={priorityInput}
                onChange={(e) => setPriorityInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    handleAddPriority();
                  }
                }}
                placeholder="Paste SKU codes…"
                className="flex-1 text-sm px-2 py-1.5 rounded-md border border-gray-200 outline-none focus:border-slate-400"
              />
              <button
                onClick={handleAddPriority}
                disabled={!priorityInput.trim()}
                className="px-2.5 py-1.5 rounded-md bg-slate-800 text-white text-xs font-bold hover:bg-slate-700 disabled:opacity-40"
              >
                Add
              </button>
            </div>
            {prioritySkus.size > 0 && (
              <div className="flex flex-wrap gap-1 mt-2">
                {[...prioritySkus].sort().map((sku) => (
                  <span
                    key={sku}
                    className="inline-flex items-center gap-1 bg-amber-50 border border-amber-200 text-amber-700 text-[11px] font-mono px-1.5 py-0.5 rounded"
                  >
                    {sku}
                    <button
                      onClick={() => onRemovePriority(sku)}
                      title={`Unpin ${sku}`}
                      className="hover:text-amber-900"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </span>
                ))}
              </div>
            )}
            <p className="text-[11px] text-slate-400 mt-1">
              Pinned SKUs get a slot before anything else, and skip the exclusion rules above.
            </p>
          </div>

          {overriddenCount > 0 && (
            <div className="px-3 py-2 border-b border-gray-100 flex items-center justify-between">
              <span className="text-xs text-slate-500">{overriddenCount} manually overridden</span>
              <button
                onClick={onClearOverrides}
                className="text-xs font-semibold text-accent hover:underline"
              >
                Clear overrides
              </button>
            </div>
          )}

          <div className="flex-1 overflow-y-auto">
            {rows.length === 0 ? (
              <div className="p-4 text-sm text-slate-400 text-center">No matching SKUs.</div>
            ) : (
              rows.map((c) => {
                const excluded = effectivelyExcludedSkus.has(c.sku);
                const autoReason = autoExclusionReasons.get(c.sku);
                const overridden = excluded !== !!autoReason;
                const pinned = prioritySkus.has(c.sku);
                return (
                  <div
                    key={c.sku}
                    className="flex items-center gap-2 px-3 py-2 text-sm hover:bg-gray-50 border-b border-gray-50 last:border-b-0"
                  >
                    <button
                      type="button"
                      onClick={() => onTogglePriority(c.sku)}
                      className="shrink-0 p-0.5"
                      title={
                        pinned
                          ? 'Unpin — back to normal ranking'
                          : 'Pin — place before everything else'
                      }
                    >
                      <Star
                        className={`w-4 h-4 ${pinned ? 'fill-amber-500 text-amber-500' : 'text-gray-300'}`}
                      />
                    </button>
                    <label className="flex items-center gap-2 flex-1 min-w-0 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={!excluded}
                        onChange={() => onToggleSku(c.sku)}
                        className="accent-accent"
                      />
                      <div className="flex-1 min-w-0">
                        <div
                          className={`font-mono font-semibold ${excluded ? 'text-slate-300 line-through' : 'text-slate-700'}`}
                        >
                          {c.sku}
                        </div>
                        {c.itemName && (
                          <div
                            className={`text-xs truncate ${excluded ? 'text-slate-300' : 'text-slate-400'}`}
                          >
                            {c.itemName}
                            {pinned ? ' · priority' : ''}
                            {autoReason
                              ? ` · ${REASON_LABEL[autoReason]}${overridden ? ' (overridden)' : ''}`
                              : ''}
                          </div>
                        )}
                      </div>
                    </label>
                    <div
                      className={`text-xs text-right shrink-0 ${excluded ? 'text-slate-300' : 'text-slate-400'}`}
                    >
                      <div>
                        {c.totalQty}u · {c.ordersCompleted}o
                      </div>
                      <div>{c.weightLbs != null ? `${c.weightLbs}lbs` : '—'}</div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
};
