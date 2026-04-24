import { describe, it, expect } from 'vitest';
import {
  getOptimizedPickingPath,
  calculatePallets,
  stackPartsOnBikes,
  calculatePalletsWithBikeAwareness,
  type PickingItem,
} from '../pickingLogic';
import type { Location } from '../../schemas/location.schema';

// ---------------------------------------------------------------------------
// getOptimizedPickingPath
// ---------------------------------------------------------------------------
describe('getOptimizedPickingPath', () => {
  const makeLocation = (
    warehouse: string,
    location: string,
    picking_order: number | null
  ): Location =>
    ({
      id: `loc-${location}`,
      warehouse,
      location,
      picking_order,
    }) as Location;

  it('sorts items by picking_order from the locations table', () => {
    const items: PickingItem[] = [
      { sku: 'A', location: 'ROW-3', warehouse: 'WH1', pickingQty: 1 },
      { sku: 'B', location: 'ROW-1', warehouse: 'WH1', pickingQty: 2 },
      { sku: 'C', location: 'ROW-2', warehouse: 'WH1', pickingQty: 3 },
    ];

    const locations = [
      makeLocation('WH1', 'ROW-1', 10),
      makeLocation('WH1', 'ROW-2', 20),
      makeLocation('WH1', 'ROW-3', 30),
    ];

    const sorted = getOptimizedPickingPath(items, locations);

    expect(sorted.map((i) => i.sku)).toEqual(['B', 'C', 'A']);
  });

  it('falls back to alphanumeric sort when picking_order is missing', () => {
    const items: PickingItem[] = [
      { sku: 'X', location: 'Z-10', warehouse: 'WH1', pickingQty: 1 },
      { sku: 'Y', location: 'A-2', warehouse: 'WH1', pickingQty: 1 },
      { sku: 'Z', location: 'A-1', warehouse: 'WH1', pickingQty: 1 },
    ];

    const sorted = getOptimizedPickingPath(items, []);

    expect(sorted.map((i) => i.sku)).toEqual(['Z', 'Y', 'X']);
  });

  it('handles null locations gracefully', () => {
    const items: PickingItem[] = [
      { sku: 'A', location: null, warehouse: 'WH1', pickingQty: 1 },
      { sku: 'B', location: 'ROW-1', warehouse: 'WH1', pickingQty: 1 },
    ];

    const sorted = getOptimizedPickingPath(items, []);

    // null location sorts before 'ROW-1'
    expect(sorted[0].sku).toBe('A');
  });

  it('is case-insensitive when matching locations', () => {
    const items: PickingItem[] = [
      { sku: 'A', location: 'row-1', warehouse: 'WH1', pickingQty: 1 },
      { sku: 'B', location: 'ROW-2', warehouse: 'WH1', pickingQty: 1 },
    ];

    const locations = [makeLocation('WH1', 'ROW-1', 50), makeLocation('WH1', 'ROW-2', 10)];

    const sorted = getOptimizedPickingPath(items, locations);

    expect(sorted.map((i) => i.sku)).toEqual(['B', 'A']);
  });

  it('does not mutate the original array', () => {
    const items: PickingItem[] = [
      { sku: 'A', location: 'B', warehouse: 'WH1', pickingQty: 1 },
      { sku: 'B', location: 'A', warehouse: 'WH1', pickingQty: 1 },
    ];

    const original = [...items];
    getOptimizedPickingPath(items, []);

    expect(items).toEqual(original);
  });
});

// ---------------------------------------------------------------------------
// calculatePallets
// ---------------------------------------------------------------------------
describe('calculatePallets', () => {
  it('returns empty array for zero items', () => {
    expect(calculatePallets([])).toEqual([]);
  });

  it('returns empty array when all pickingQty are 0', () => {
    const items: PickingItem[] = [{ sku: 'A', location: 'R1', pickingQty: 0 }];
    expect(calculatePallets(items)).toEqual([]);
  });

  it('fits 8 units into a single pallet of 8', () => {
    const items: PickingItem[] = [{ sku: 'A', location: 'R1', pickingQty: 8 }];

    const pallets = calculatePallets(items);

    expect(pallets).toHaveLength(1);
    expect(pallets[0].totalUnits).toBe(8);
    expect(pallets[0].limitPerPallet).toBe(8);
  });

  it('chooses limit=8 for 16 units (2 pallets of 8 instead of other combos)', () => {
    const items: PickingItem[] = [{ sku: 'A', location: 'R1', pickingQty: 16 }];

    const pallets = calculatePallets(items);

    // 16/12 = 2 pallets, 16/10 = 2, 16/8 = 2 → prefer 8 (smallest)
    expect(pallets).toHaveLength(2);
    expect(pallets[0].limitPerPallet).toBe(8);
  });

  it('chooses limit=10 for 9 units (1 pallet)', () => {
    // 9/12=1, 9/10=1, 9/8=2 → min pallets is 1, smallest capacity achieving 1 pallet is 10
    const items: PickingItem[] = [{ sku: 'A', location: 'R1', pickingQty: 9 }];

    const pallets = calculatePallets(items);

    expect(pallets).toHaveLength(1);
    expect(pallets[0].limitPerPallet).toBe(10);
  });

  it('chooses limit=12 for 11 units (1 pallet)', () => {
    // 11/12=1, 11/10=2, 11/8=2 → only 12 achieves 1 pallet
    const items: PickingItem[] = [{ sku: 'A', location: 'R1', pickingQty: 11 }];

    const pallets = calculatePallets(items);

    expect(pallets).toHaveLength(1);
    expect(pallets[0].limitPerPallet).toBe(12);
  });

  it('merges same SKU+Location items within a pallet', () => {
    const items: PickingItem[] = [
      { sku: 'A', location: 'R1', pickingQty: 3 },
      { sku: 'A', location: 'R1', pickingQty: 2 },
    ];

    const pallets = calculatePallets(items);

    expect(pallets).toHaveLength(1);
    expect(pallets[0].items).toHaveLength(1);
    expect(pallets[0].items[0].pickingQty).toBe(5);
  });

  it('splits a large item across multiple pallets', () => {
    const items: PickingItem[] = [{ sku: 'A', location: 'R1', pickingQty: 20 }];

    const pallets = calculatePallets(items);

    // 20/12=2 pallets, 20/10=2, 20/8=3 → min is 2, smallest achieving 2 is 10
    expect(pallets).toHaveLength(2);
    expect(pallets[0].totalUnits).toBe(10);
    expect(pallets[1].totalUnits).toBe(10);
  });

  it('assigns sequential pallet IDs', () => {
    const items: PickingItem[] = [{ sku: 'A', location: 'R1', pickingQty: 25 }];

    const pallets = calculatePallets(items);

    expect(pallets.map((p) => p.id)).toEqual(pallets.map((_, i) => i + 1));
  });

  it('handles mixed items across pallets correctly', () => {
    const items: PickingItem[] = [
      { sku: 'A', location: 'R1', pickingQty: 6 },
      { sku: 'B', location: 'R2', pickingQty: 4 },
      { sku: 'C', location: 'R3', pickingQty: 5 },
    ];

    const pallets = calculatePallets(items);

    // Total = 15, 15/12=2, 15/10=2, 15/8=2 → prefer 8
    expect(pallets).toHaveLength(2);
    const totalAcross = pallets.reduce((s, p) => s + p.totalUnits, 0);
    expect(totalAcross).toBe(15);
  });
});

// ---------------------------------------------------------------------------
// stackPartsOnBikes
// ---------------------------------------------------------------------------
describe('stackPartsOnBikes', () => {
  it('returns pallets unchanged when no bikes are present', () => {
    const items: PickingItem[] = [
      { sku: 'PART-A', location: 'R1', pickingQty: 20 },
      { sku: 'PART-B', location: 'R2', pickingQty: 10 },
    ];
    const pallets = calculatePallets(items);
    const result = stackPartsOnBikes(pallets, new Set());
    expect(result).toEqual(pallets);
  });

  it('returns pallets unchanged when bikeSkuSet has no matches in items', () => {
    const items: PickingItem[] = [{ sku: 'PART-A', location: 'R1', pickingQty: 20 }];
    const pallets = calculatePallets(items);
    const result = stackPartsOnBikes(pallets, new Set(['BIKE-X']));
    expect(result).toEqual(pallets);
  });

  it('consolidates parts into the single bike pallet', () => {
    // 4 bikes + 300 parts; bikes only fit 1 pallet, parts would span many
    const items: PickingItem[] = [
      { sku: 'BIKE-1', location: 'R1', pickingQty: 4 },
      { sku: 'PART-A', location: 'R2', pickingQty: 300 },
    ];
    const pallets = calculatePallets(items);
    const result = stackPartsOnBikes(pallets, new Set(['BIKE-1']));

    expect(result).toHaveLength(1);
    expect(result[0].totalUnits).toBe(304);
    expect(result[0].items.map((i) => i.sku).sort()).toEqual(['BIKE-1', 'PART-A']);
  });

  it('stacks parts onto the last pallet containing bikes when multiple bike pallets exist', () => {
    // 20 bikes (2 bike pallets at 10 each) + 50 parts
    const items: PickingItem[] = [
      { sku: 'BIKE-1', location: 'R1', pickingQty: 20 },
      { sku: 'PART-A', location: 'R2', pickingQty: 50 },
    ];
    const pallets = calculatePallets(items);
    const result = stackPartsOnBikes(pallets, new Set(['BIKE-1']));

    // First pallet stays bike-only, last bike pallet absorbs all parts
    const totalAcross = result.reduce((s, p) => s + p.totalUnits, 0);
    expect(totalAcross).toBe(70);
    const lastPallet = result[result.length - 1];
    expect(lastPallet.items.some((i) => i.sku === 'PART-A')).toBe(true);
    expect(lastPallet.items.some((i) => i.sku === 'BIKE-1')).toBe(true);
    // No part items in any earlier pallet
    const earlierHasParts = result
      .slice(0, -1)
      .some((p) => p.items.some((i) => i.sku === 'PART-A'));
    expect(earlierHasParts).toBe(false);
  });

  it('renumbers pallet ids sequentially after empty ones are dropped', () => {
    const items: PickingItem[] = [
      { sku: 'BIKE-1', location: 'R1', pickingQty: 8 },
      { sku: 'PART-A', location: 'R2', pickingQty: 50 },
    ];
    const pallets = calculatePallets(items);
    const result = stackPartsOnBikes(pallets, new Set(['BIKE-1']));
    expect(result.map((p) => p.id)).toEqual(result.map((_, i) => i + 1));
  });

  it('marks stacked items with isStackedPart flag', () => {
    const items: PickingItem[] = [
      { sku: 'BIKE-1', location: 'R1', pickingQty: 5 },
      { sku: 'PART-A', location: 'R2', pickingQty: 20 },
    ];
    const pallets = calculatePallets(items);
    const result = stackPartsOnBikes(pallets, new Set(['BIKE-1']));
    const part = result[result.length - 1].items.find((i) => i.sku === 'PART-A');
    expect(part?.isStackedPart).toBe(true);
    const bike = result[result.length - 1].items.find((i) => i.sku === 'BIKE-1');
    expect(bike?.isStackedPart).toBeFalsy();
  });

  it('merges same-SKU parts moved from different pallets', () => {
    // Build pallets manually to simulate scenario where PART-A exists in two pallets
    const pallets = [
      {
        id: 1,
        items: [
          { sku: 'BIKE-1', location: 'R1', pickingQty: 10 },
          { sku: 'PART-A', location: 'R2', pickingQty: 5 },
        ],
        totalUnits: 15,
        footprint_in2: 0,
        limitPerPallet: 10,
      },
      {
        id: 2,
        items: [
          { sku: 'BIKE-2', location: 'R3', pickingQty: 3 },
          { sku: 'PART-A', location: 'R2', pickingQty: 7 },
        ],
        totalUnits: 10,
        footprint_in2: 0,
        limitPerPallet: 10,
      },
    ];
    const result = stackPartsOnBikes(pallets, new Set(['BIKE-1', 'BIKE-2']));

    // Last bike pallet (id=2) should contain BIKE-2 + merged PART-A (5+7=12)
    const last = result[result.length - 1];
    const merged = last.items.find((i) => i.sku === 'PART-A');
    expect(merged?.pickingQty).toBe(12);
    // First pallet should no longer have PART-A
    expect(result[0].items.some((i) => i.sku === 'PART-A')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// calculatePalletsWithBikeAwareness
// ---------------------------------------------------------------------------
describe('calculatePalletsWithBikeAwareness', () => {
  it('falls back to calculatePallets when no bikes are present', () => {
    const items: PickingItem[] = [{ sku: 'PART-A', location: 'R1', pickingQty: 30 }];
    const result = calculatePalletsWithBikeAwareness(items, new Set());
    expect(result).toEqual(calculatePallets(items));
  });

  it('sizes pallets by bike units only — 15 bikes + 300 parts fits in 2 pallets', () => {
    // Without bike-awareness: 315 units → ceil(315/12)=27 pallets at limit 12
    // With bike-awareness: 15 bike units → 2 pallets at limit 8, parts stack on pallet 2
    const items: PickingItem[] = [
      { sku: 'BIKE-1', location: 'R1', pickingQty: 15 },
      { sku: 'PART-A', location: 'R2', pickingQty: 300 },
    ];
    const result = calculatePalletsWithBikeAwareness(items, new Set(['BIKE-1']));
    expect(result).toHaveLength(2);
    // Pallet 1 is bike-only (8 bikes)
    expect(result[0].items.every((i) => i.sku === 'BIKE-1')).toBe(true);
    expect(result[0].totalUnits).toBe(8);
    // Pallet 2 has remaining bikes + all parts
    expect(result[1].totalUnits).toBe(307);
    expect(result[1].items.find((i) => i.sku === 'PART-A')?.isStackedPart).toBe(true);
  });

  it('single bike pallet absorbs all parts regardless of qty', () => {
    const items: PickingItem[] = [
      { sku: 'BIKE-1', location: 'R1', pickingQty: 3 },
      { sku: 'PART-A', location: 'R2', pickingQty: 5000 },
    ];
    const result = calculatePalletsWithBikeAwareness(items, new Set(['BIKE-1']));
    expect(result).toHaveLength(1);
    expect(result[0].totalUnits).toBe(5003);
  });

  it('parts-only order with empty bikeSkuSet still paginates normally', () => {
    const items: PickingItem[] = [{ sku: 'PART-A', location: 'R1', pickingQty: 30 }];
    const result = calculatePalletsWithBikeAwareness(items, new Set(['BIKE-X']));
    // bikeSkuSet has entries but no items match → falls back to calculatePallets
    expect(result).toEqual(calculatePallets(items));
  });
});
