import React from 'react';
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

  return (
    <div
      className={`h-1.5 w-full bg-surface rounded-full overflow-hidden border border-subtle ${className}`}
    >
      <div
        className="h-full transition-all duration-500 ease-out"
        style={{
          width: `${progressPercent}%`,
          background:
            'linear-gradient(to right, rgb(59, 130, 246), rgb(6, 182, 212), rgb(16, 185, 129)) 0% 0% / 162.242% 100%',
        }}
      />
    </div>
  );
};
