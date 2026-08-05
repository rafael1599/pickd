import React from 'react';
import { calculatePalletsWithBikeAwareness } from '../../../utils/pickingLogic';
import { isBikeSku } from '../../../utils/bikeDetection';

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
    // Only completed or shipped orders are guaranteed 100% finished
    if (status === 'completed' || isShipped) {
      return 100;
    }
    if (status === 'ready_to_double_check' || status === 'active') {
      return 0;
    }

    const vKeys = new Set(verifiedKeys ?? []);

    // Lightweight approximation when items are not fetched to save bandwidth
    if (!Array.isArray(items) || items.length === 0) {
      if (totalUnits > 0 && vKeys.size > 0) {
        // Cap at 95% for approximations during active verification/picking
        return Math.min(95, Math.round((vKeys.size / totalUnits) * 100));
      }
      return 0;
    }

    const bikeSkuSet = new Set<string>();
    for (const item of items) {
      if (isBikeSku(item.sku, item.sku_metadata)) {
        if (item.sku) bikeSkuSet.add(item.sku);
      }
    }

    // Normalize to the util's required shape — lightweight projections may
    // carry optional sku/pickingQty; default them so missing data just
    // contributes 0 instead of failing to type-check or compute.
    const normalized = items.map((i) => {
      const rawQty =
        i.pickingQty ??
        (i as { qty?: number }).qty ??
        (i as { quantity?: number | string }).quantity;
      return {
        ...i,
        sku: i.sku ?? '',
        pickingQty: typeof rawQty === 'string' ? Number(rawQty) || 0 : rawQty || 0,
        location: i.location ?? null,
      };
    });
    const pallets = calculatePalletsWithBikeAwareness(normalized, bikeSkuSet);

    const verifiedSuffixCounts = new Map<string, number>();
    for (const vk of vKeys) {
      const dashIdx = vk.indexOf('-');
      if (dashIdx !== -1) {
        const suffix = vk.slice(dashIdx);
        verifiedSuffixCounts.set(suffix, (verifiedSuffixCounts.get(suffix) ?? 0) + 1);
      }
    }

    let calcTotalUnits = 0;
    let verifiedUnits = 0;

    for (const pallet of pallets) {
      for (const item of pallet.items) {
        const qty = item.pickingQty || 0;
        calcTotalUnits += qty;

        const key = `${pallet.id}-${item.sku}-${item.location}`;
        const suffix = `-${item.sku}-${item.location}`;

        let isMatched = vKeys.has(key);
        if (!isMatched) {
          const count = verifiedSuffixCounts.get(suffix) ?? 0;
          if (count > 0) {
            isMatched = true;
            verifiedSuffixCounts.set(suffix, count - 1);
          }
        }

        if (isMatched) {
          verifiedUnits += qty;
        }
      }
    }

    if (calcTotalUnits === 0) return 0;
    if (verifiedUnits >= calcTotalUnits) return 100;
    return Math.min(95, Math.round((verifiedUnits / calcTotalUnits) * 100));
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
