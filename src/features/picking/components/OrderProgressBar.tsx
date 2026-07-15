import React from 'react';
import type { PickingListItem } from '../../../schemas/picking.schema';
import { calculatePalletsWithBikeAwareness } from '../../../utils/pickingLogic';

interface OrderProgressBarProps {
  status: string;
  isShipped?: boolean;
  items?: PickingListItem[] | null;
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
  className = 'mt-2',
}) => {
  const progressPercent = React.useMemo(() => {
    if (status === 'completed' || isShipped) return 100;

    const vKeys = new Set(verifiedKeys ?? []);

    // Lightweight approximation when items are not fetched to save bandwidth
    if (!Array.isArray(items) || items.length === 0) {
      if (totalUnits > 0) {
        // Cap at 95% for approximations to distinguish from truly completed
        return Math.min(95, Math.round((vKeys.size / totalUnits) * 100));
      }
      return 0;
    }

    const bikeSkuSet = new Set<string>();
    for (const item of items) {
      if (item.sku && item.sku.startsWith('03-')) {
        bikeSkuSet.add(item.sku);
      }
    }

    const pallets = calculatePalletsWithBikeAwareness(items, bikeSkuSet);

    let calcTotalUnits = 0;
    let verifiedUnits = 0;
    let pickedUnits = 0;

    for (const pallet of pallets) {
      for (const item of pallet.items) {
        const qty = item.pickingQty || 0;
        calcTotalUnits += qty;

        // Verification progress
        const key = `${pallet.id}-${item.sku}-${item.location}`;
        if (vKeys.has(key)) {
          verifiedUnits += qty;
        }

        // Picking progress
        if (item.checked) {
          pickedUnits += qty;
        }
      }
    }

    if (calcTotalUnits === 0) return 0;

    // We show the highest progress achieved.
    // In picking phase, verified is 0, so it shows picked.
    // In double-check phase, picked is usually 100%, but we want to show
    // verified progress. Wait, if picked is 100% during double-check,
    // max() would always return 100%!
    // We need to differentiate the phases.

    if (['ready_to_double_check', 'double_checking'].includes(status)) {
      // During double check, only verified units count towards progress
      return Math.min(95, Math.round((verifiedUnits / calcTotalUnits) * 100));
    }

    // During active picking (or waiting for inventory)
    return Math.min(95, Math.round((pickedUnits / calcTotalUnits) * 100));
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
