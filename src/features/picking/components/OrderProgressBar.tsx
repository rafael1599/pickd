import React from 'react';
import Package from 'lucide-react/dist/esm/icons/package';
import { verificationProgress } from '../utils/verificationProgress';

/** Minimal item shape the progress calculation actually reads — looser than
 * `PickingListItem` so lightweight projections (e.g. the Orders board) can
 * pass their items without widening to the full inventory-item schema. */
interface ProgressItem {
  sku?: string;
  location?: string | null;
  pickingQty?: number;
  checked?: boolean;
  sku_metadata?: { is_bike?: boolean | null } | null;
}

interface OrderProgressBarProps {
  status: string;
  isShipped?: boolean;
  items?: ProgressItem[] | null;
  verifiedKeys?: string[] | null;
  totalUnits?: number;
  className?: string;
}

export const OrderProgressBar: React.FC<OrderProgressBarProps> = ({
  status,
  isShipped,
  items,
  verifiedKeys,
  totalUnits = 0,
  className = '',
}) => {
  const progressPercent = React.useMemo(() => {
    // Lightweight approximation when items are not fetched to save bandwidth
    if (
      (!Array.isArray(items) || items.length === 0) &&
      status !== 'completed' &&
      !isShipped &&
      status !== 'ready_to_double_check'
    ) {
      const vKeys = new Set(verifiedKeys ?? []);
      if (totalUnits > 0 && vKeys.size > 0) {
        // Cap at 95% for approximations during active verification/picking
        return Math.min(95, Math.round((vKeys.size / totalUnits) * 100));
      }
      return 0;
    }
    // The same reading as the Live Board's bars (utils/verificationProgress).
    return verificationProgress({
      status,
      is_shipped: isShipped,
      items,
      verified_item_keys: verifiedKeys,
    });
  }, [status, isShipped, items, verifiedKeys, totalUnits]);

  // A moving job (not yet done, not just started) gets the bouncing box;
  // done ones sit still and green instead of bouncing forever across dozens
  // of completed cards at once (Rafael, 18 sep 2026: "más movida... una
  // pequeña cajita").
  const moving = progressPercent > 0 && progressPercent < 100;

  return (
    <div className={`relative flex w-full items-center py-1 ${className}`}>
      <div className="h-1.5 w-full bg-surface rounded-full overflow-hidden border border-subtle">
        <div
          className="h-full transition-all duration-500 ease-out"
          style={{
            width: `${progressPercent}%`,
            background:
              'linear-gradient(to right, rgb(59, 130, 246), rgb(6, 182, 212), rgb(16, 185, 129)) 0% 0% / 162.242% 100%',
          }}
        />
      </div>
      {progressPercent > 0 && (
        <div
          className="pointer-events-none absolute top-1/2 -translate-x-1/2 -translate-y-1/2 transition-all duration-500 ease-out"
          style={{ left: `${Math.max(4, Math.min(progressPercent, 96))}%` }}
        >
          <div
            className={`rounded border border-subtle bg-card p-0.5 shadow-sm ${
              moving ? 'text-accent motion-safe:animate-bounce' : 'text-emerald-400'
            }`}
          >
            <Package size={11} strokeWidth={2.5} />
          </div>
        </div>
      )}
    </div>
  );
};
