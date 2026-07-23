import React, { useMemo, useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import type { RankedCandidate } from '../../hooks/useOverstockLayoutPlan';
import type { AutoExclusionReason } from './WarehouseMap';

interface ExcludedItemsSummaryProps {
  pool: RankedCandidate[];
  autoExclusionReasons: Map<string, AutoExclusionReason>;
  effectivelyExcludedSkus: Set<string>;
}

const REASON_LABEL: Record<AutoExclusionReason, string> = {
  'wide box': 'wide box',
  juvenile: 'juvenile',
  weight: 'weight',
};

/**
 * Always-visible (not tucked inside the Filters popover) list of what's
 * currently being left out of the block because of size/weight rules — so
 * it's obvious at a glance without having to open Filters and search.
 * Screen-only (print:hidden) — this is a working aid, not part of the plan.
 */
export const ExcludedItemsSummary: React.FC<ExcludedItemsSummaryProps> = ({
  pool,
  autoExclusionReasons,
  effectivelyExcludedSkus,
}) => {
  const [expanded, setExpanded] = useState(false);

  const excluded = useMemo(
    () =>
      pool
        .filter((c) => autoExclusionReasons.has(c.sku) && effectivelyExcludedSkus.has(c.sku))
        .map((c) => ({ ...c, reason: autoExclusionReasons.get(c.sku) as AutoExclusionReason })),
    [pool, autoExclusionReasons, effectivelyExcludedSkus]
  );

  const counts = useMemo(() => {
    const map = new Map<AutoExclusionReason, number>();
    for (const c of excluded) map.set(c.reason, (map.get(c.reason) ?? 0) + 1);
    return map;
  }, [excluded]);

  if (excluded.length === 0) return null;

  return (
    <div className="print:hidden mb-4 rounded-xl border border-amber-100 bg-amber-50/60">
      <button
        onClick={() => setExpanded((e) => !e)}
        className="w-full flex items-center justify-between px-4 py-2.5 text-left"
      >
        <span className="text-sm text-amber-800">
          <span className="font-semibold">{excluded.length} excluded</span> for size/weight —{' '}
          {[...counts.entries()].map(([reason, n]) => `${n} ${REASON_LABEL[reason]}`).join(' · ')}
        </span>
        {expanded ? (
          <ChevronUp className="w-4 h-4 text-amber-600 shrink-0" />
        ) : (
          <ChevronDown className="w-4 h-4 text-amber-600 shrink-0" />
        )}
      </button>

      {expanded && (
        <div className="max-h-56 overflow-y-auto border-t border-amber-100 divide-y divide-amber-100/70">
          {excluded.map((c) => (
            <div key={c.sku} className="flex items-center justify-between px-4 py-1.5 text-xs">
              <div className="min-w-0">
                <span className="font-mono font-semibold text-amber-900">{c.sku}</span>
                {c.itemName && (
                  <span className="text-amber-700/80 ml-1.5 truncate">{c.itemName}</span>
                )}
              </div>
              <span className="shrink-0 ml-2 text-amber-600 font-medium">
                {REASON_LABEL[c.reason]}
                {c.reason === 'weight' && c.weightLbs != null ? ` (${c.weightLbs}lbs)` : ''}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
