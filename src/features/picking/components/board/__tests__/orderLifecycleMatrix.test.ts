import { describe, expect, it } from 'vitest';
import { mergeGroupOrders } from '../mergeGroupOrders';
import {
  calculatePalletsWithBikeAwareness,
  type PickingItem,
} from '../../../../../utils/pickingLogic';
import { isBikeSku } from '../../../../../utils/bikeDetection';
import type { PickingList } from '../../../hooks/useDoubleCheckList';

function computeProgressPercent(order: PickingList, bikeSkuSet: Set<string>): number {
  if (order.status === 'completed' || order.is_shipped) {
    return 100;
  }
  if (order.status === 'ready_to_double_check' || order.status === 'active') {
    return 0;
  }
  if (!Array.isArray(order.items) || order.items.length === 0) return 0;

  const verifiedKeys = new Set(order.verified_item_keys ?? []);
  if (verifiedKeys.size === 0) return 0;

  const currentBikeSkuSet = new Set<string>();
  for (const item of order.items) {
    const sku = typeof item.sku === 'string' ? item.sku : '';
    const isBike =
      (bikeSkuSet && bikeSkuSet.has(sku)) ||
      isBikeSku(sku, item.sku_metadata as { is_bike?: boolean | null } | null);
    if (isBike && sku) {
      currentBikeSkuSet.add(sku);
    }
  }

  const allItems = (order.items ?? []).map((i: any) => {
    const rawQty =
      i.pickingQty ?? (i as { qty?: number }).qty ?? (i as { quantity?: number | string }).quantity;
    return {
      ...i,
      sku: typeof i.sku === 'string' ? i.sku : '',
      pickingQty: typeof rawQty === 'string' ? Number(rawQty) || 0 : rawQty || 0,
      location: i.location ?? null,
    };
  }) as unknown as PickingItem[];

  const pallets = calculatePalletsWithBikeAwareness(allItems, currentBikeSkuSet);

  const verifiedSuffixCounts = new Map<string, number>();
  for (const vk of verifiedKeys) {
    const dashIdx = vk.indexOf('-');
    if (dashIdx !== -1) {
      const suffix = vk.slice(dashIdx);
      verifiedSuffixCounts.set(suffix, (verifiedSuffixCounts.get(suffix) ?? 0) + 1);
    }
  }

  let totalUnits = 0;
  let verifiedUnits = 0;

  for (const pallet of pallets) {
    for (const item of pallet.items) {
      const qty = item.pickingQty || 0;
      totalUnits += qty;
      const key = `${pallet.id}-${item.sku}-${item.location}`;
      const suffix = `-${item.sku}-${item.location}`;

      let isMatched = verifiedKeys.has(key);
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

  if (totalUnits === 0) return 0;
  if (verifiedUnits >= totalUnits) return 100;
  return Math.min(95, Math.round((verifiedUnits / totalUnits) * 100));
}

function makeItem(sku: string, qty: number, loc: string, isBike: boolean) {
  return {
    sku,
    pickingQty: qty,
    location: loc,
    item_name: isBike ? `Bike ${sku}` : `Part ${sku}`,
    sku_metadata: { is_bike: isBike },
  };
}

describe('Order Lifecycle Matrix Integration Tests', () => {
  const bikeSkuSet = new Set([
    'BIKE-01',
    'BIKE-02',
    'BIKE-03',
    'BIKE-04',
    '03-4662YL',
    '03-4663GN',
  ]);

  it('1. Single Unit Parts Order (1u) — 0% on Watcher/Active, 100% on DoubleCheck Verified/Completed', () => {
    const items = [makeItem('PART-01', 1, 'ROW 1', false)];
    expect(
      computeProgressPercent(
        { status: 'ready_to_double_check', items, verified_item_keys: [] } as any,
        bikeSkuSet
      )
    ).toBe(0);
    expect(
      computeProgressPercent({ status: 'active', items, verified_item_keys: [] } as any, bikeSkuSet)
    ).toBe(0);
    expect(
      computeProgressPercent(
        { status: 'double_checking', items, verified_item_keys: [] } as any,
        bikeSkuSet
      )
    ).toBe(0);
    expect(
      computeProgressPercent(
        { status: 'double_checking', items, verified_item_keys: ['1-PART-01-ROW 1'] } as any,
        bikeSkuSet
      )
    ).toBe(100);
    expect(
      computeProgressPercent(
        { status: 'completed', items, verified_item_keys: ['1-PART-01-ROW 1'] } as any,
        bikeSkuSet
      )
    ).toBe(100);
  });

  it('2. Single Unit Bike Order (1u) — 0% on Watcher/Active, 100% on DoubleCheck Verified/Completed', () => {
    const items = [makeItem('BIKE-01', 1, 'ROW 2', true)];
    expect(
      computeProgressPercent(
        { status: 'ready_to_double_check', items, verified_item_keys: [] } as any,
        bikeSkuSet
      )
    ).toBe(0);
    expect(
      computeProgressPercent({ status: 'active', items, verified_item_keys: [] } as any, bikeSkuSet)
    ).toBe(0);
    expect(
      computeProgressPercent(
        { status: 'double_checking', items, verified_item_keys: [] } as any,
        bikeSkuSet
      )
    ).toBe(0);
    expect(
      computeProgressPercent(
        { status: 'double_checking', items, verified_item_keys: ['1-BIKE-01-ROW 2'] } as any,
        bikeSkuSet
      )
    ).toBe(100);
    expect(
      computeProgressPercent(
        { status: 'completed', items, verified_item_keys: ['1-BIKE-01-ROW 2'] } as any,
        bikeSkuSet
      )
    ).toBe(100);
  });

  it('3. 25 Units Parts Order (25u) — Partial progress proportional to verified units, 0% on Watcher/Active', () => {
    const items = [
      makeItem('PART-01', 10, 'ROW 1', false),
      makeItem('PART-02', 15, 'ROW 3', false),
    ];
    expect(
      computeProgressPercent(
        { status: 'ready_to_double_check', items, verified_item_keys: [] } as any,
        bikeSkuSet
      )
    ).toBe(0);
    expect(
      computeProgressPercent({ status: 'active', items, verified_item_keys: [] } as any, bikeSkuSet)
    ).toBe(0);
    expect(
      computeProgressPercent(
        { status: 'double_checking', items, verified_item_keys: [] } as any,
        bikeSkuSet
      )
    ).toBe(0);
    expect(
      computeProgressPercent(
        { status: 'double_checking', items, verified_item_keys: ['1-PART-01-ROW 1'] } as any,
        bikeSkuSet
      )
    ).toBe(40);
    expect(
      computeProgressPercent(
        {
          status: 'double_checking',
          items,
          verified_item_keys: ['1-PART-01-ROW 1', '1-PART-02-ROW 3'],
        } as any,
        bikeSkuSet
      )
    ).toBe(100);
    expect(
      computeProgressPercent(
        { status: 'completed', items, verified_item_keys: [] } as any,
        bikeSkuSet
      )
    ).toBe(100);
  });

  it('4. 25 Units Bike Order (25u multi-pallet) — Flexible key matching across pallets', () => {
    const items = [
      makeItem('BIKE-01', 12, 'ROW 10', true),
      makeItem('BIKE-02', 13, 'ROW 11', true),
    ];
    const allItems = items as unknown as PickingItem[];
    const pallets = calculatePalletsWithBikeAwareness(allItems, bikeSkuSet);
    const allKeys = pallets.flatMap((p) => p.items.map((i) => `${p.id}-${i.sku}-${i.location}`));
    const halfKeys = allKeys.slice(0, Math.ceil(allKeys.length / 2));

    expect(
      computeProgressPercent(
        { status: 'ready_to_double_check', items, verified_item_keys: [] } as any,
        bikeSkuSet
      )
    ).toBe(0);
    expect(
      computeProgressPercent(
        { status: 'double_checking', items, verified_item_keys: halfKeys } as any,
        bikeSkuSet
      )
    ).toBe(48);
    expect(
      computeProgressPercent(
        { status: 'double_checking', items, verified_item_keys: allKeys } as any,
        bikeSkuSet
      )
    ).toBe(100);
  });

  it('5. 45 Units Mixed Order (30 Bikes + 15 Parts) — Multi-pallet bike + parts consolidation', () => {
    const items = [
      makeItem('BIKE-01', 15, 'ROW 10', true),
      makeItem('BIKE-02', 15, 'ROW 11', true),
      makeItem('PART-01', 15, 'ROW 1', false),
    ];
    const allItems = items as unknown as PickingItem[];
    const pallets = calculatePalletsWithBikeAwareness(allItems, bikeSkuSet);
    const allKeys = pallets.flatMap((p) => p.items.map((i) => `${p.id}-${i.sku}-${i.location}`));

    expect(
      computeProgressPercent(
        { status: 'ready_to_double_check', items, verified_item_keys: [] } as any,
        bikeSkuSet
      )
    ).toBe(0);
    expect(
      computeProgressPercent(
        { status: 'double_checking', items, verified_item_keys: allKeys } as any,
        bikeSkuSet
      )
    ).toBe(100);
    expect(
      computeProgressPercent(
        { status: 'completed', items, verified_item_keys: [] } as any,
        bikeSkuSet
      )
    ).toBe(100);
  });

  it('6. Combined Group Order — Does NOT inherit verified keys from siblings when newly arrived', () => {
    const groupA = {
      id: 'order-a',
      order_number: '889001',
      status: 'ready_to_double_check',
      items: [makeItem('BIKE-01', 10, 'ROW 10', true)],
      verified_item_keys: [],
    };
    const groupB = {
      id: 'order-b',
      order_number: '889002',
      status: 'ready_to_double_check',
      items: [makeItem('BIKE-02', 15, 'ROW 11', true)],
      verified_item_keys: [],
    };

    const mergedNew = mergeGroupOrders([groupA, groupB] as any);
    expect(computeProgressPercent(mergedNew, bikeSkuSet)).toBe(0);

    const groupA_checked = {
      ...groupA,
      status: 'double_checking',
      verified_item_keys: ['1-BIKE-01-ROW 10'],
    };
    const groupB_checked = {
      ...groupB,
      status: 'double_checking',
      verified_item_keys: ['2-BIKE-02-ROW 11'],
    };
    const mergedChecked = mergeGroupOrders([groupA_checked, groupB_checked] as any);
    expect(computeProgressPercent(mergedChecked, bikeSkuSet)).toBe(100);
  });
});
