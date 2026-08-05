import { describe, it, expect } from 'vitest';
import { calculatePalletsWithBikeAwareness } from '../../../../utils/pickingLogic';
import { isBikeSku } from '../../../../utils/bikeDetection';

/**
 * Pure helper mirroring OrderProgressBar's progressPercent calculation.
 * Only completed or shipped orders return 100%. All other orders (ready_to_double_check,
 * double_checking, active, needs_correction) calculate progress from verified_item_keys.
 */
function computeProgressPercent(
  status: string,
  isShipped: boolean | undefined,
  items:
    | {
        sku?: string;
        location?: string | null;
        pickingQty?: number;
        checked?: boolean;
        sku_metadata?: { is_bike?: boolean | null } | null;
      }[]
    | null
    | undefined,
  verifiedKeys: string[] | null | undefined,
  totalUnits: number = 0
): number {
  if (status === 'completed' || isShipped) {
    return 100;
  }

  const vKeys = new Set(verifiedKeys ?? []);

  if (!Array.isArray(items) || items.length === 0) {
    if (totalUnits > 0 && vKeys.size > 0) {
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

  const normalized = items.map((i) => ({
    ...i,
    sku: i.sku ?? '',
    pickingQty: i.pickingQty ?? 0,
    location: i.location ?? null,
  }));
  const pallets = calculatePalletsWithBikeAwareness(normalized, bikeSkuSet);

  let calcTotalUnits = 0;
  let verifiedUnits = 0;

  for (const pallet of pallets) {
    for (const item of pallet.items) {
      const qty = item.pickingQty || 0;
      calcTotalUnits += qty;

      const key = `${pallet.id}-${item.sku}-${item.location}`;
      if (vKeys.has(key)) {
        verifiedUnits += qty;
      }
    }
  }

  if (calcTotalUnits === 0) return 0;

  return Math.min(95, Math.round((verifiedUnits / calcTotalUnits) * 100));
}

describe('OrderProgressBar calculation (Real Verification Progress)', () => {
  it('returns 0% for ready_to_double_check or double_checking order with 0 verified items', () => {
    const items = [
      { sku: '03-1000BL', pickingQty: 2, location: 'ROW 10', sku_metadata: { is_bike: true } },
      { sku: '98-1000', pickingQty: 3, location: 'ROW 5', sku_metadata: { is_bike: false } },
    ];
    expect(computeProgressPercent('ready_to_double_check', false, items, [])).toBe(0);
    expect(computeProgressPercent('double_checking', false, items, [])).toBe(0);
  });

  it('calculates proportional progress when items are partially verified', () => {
    const items = [
      { sku: '03-1000BL', pickingQty: 2, location: 'ROW 10', sku_metadata: { is_bike: true } },
      { sku: '03-2000RD', pickingQty: 2, location: 'ROW 12', sku_metadata: { is_bike: true } },
    ];
    const verifiedKeys = ['1-03-1000BL-ROW 10'];
    expect(computeProgressPercent('double_checking', false, items, verifiedKeys)).toBe(50);
  });

  it('returns 100% only when status is completed or isShipped is true', () => {
    const items = [
      { sku: '03-1000BL', pickingQty: 2, location: 'ROW 10', sku_metadata: { is_bike: true } },
    ];
    expect(computeProgressPercent('completed', false, items, [])).toBe(100);
    expect(computeProgressPercent('ready_to_double_check', true, items, [])).toBe(100);
  });
});
