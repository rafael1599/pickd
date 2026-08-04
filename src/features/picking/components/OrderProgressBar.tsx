import React from 'react';
import { calculatePalletsWithBikeAwareness } from '../../../utils/pickingLogic';

/** Minimal item shape the progress calculation actually reads — looser than
 * `PickingListItem` so lightweight projections (e.g. the Orders board) can
 * pass their items without widening to the full inventory-item schema. */
interface ProgressItem {
  sku?: string;
  location?: string | null;
  pickingQty?: number;
  checked?: boolean;
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
  className = 'mt-2',
}) => {
  const progressPercent = React.useMemo(() => {
    // Orders sent to DS (ready_to_double_check, double_checking, completed) have fully completed picking
    if (['ready_to_double_check', 'double_checking', 'completed'].includes(status) || isShipped) {
      return 100;
    }

    const vKeys = new Set(verifiedKeys ?? []);

    // Lightweight approximation when items are not fetched to save bandwidth
    if (!Array.isArray(items) || items.length === 0) {
      if (totalUnits > 0) {
        // Cap at 95% for approximations during active picking
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

    // Normalize to the util's required shape — lightweight projections may
    // carry optional sku/pickingQty; default them so missing data just
    // contributes 0 instead of failing to type-check or compute.
    const normalized = items.map((i) => ({
      ...i,
      sku: i.sku ?? '',
      pickingQty: i.pickingQty ?? 0,
      location: i.location ?? null,
    }));
    const pallets = calculatePalletsWithBikeAwareness(normalized, bikeSkuSet);

    let calcTotalUnits = 0;
    let pickedUnits = 0;

    for (const pallet of pallets) {
      for (const item of pallet.items) {
        const qty = item.pickingQty || 0;
        calcTotalUnits += qty;

        // Picking progress. `checked` is carried through from the source
        // PickingListItem (via spread); the util's PickingItem type drops it,
        // so read it through a narrow cast instead of widening the util type.
        if ((item as { checked?: boolean }).checked) {
          pickedUnits += qty;
        }
      }
    }

    if (calcTotalUnits === 0) return 0;

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
