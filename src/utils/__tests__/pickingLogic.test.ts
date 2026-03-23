import { describe, it, expect } from 'vitest';
import { getOptimizedPickingPath, calculatePallets, type PickingItem } from '../pickingLogic';
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
