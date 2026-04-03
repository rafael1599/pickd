import { describe, it, expect } from 'vitest';

/**
 * Mirrors the delta calculation logic from recomplete_picking_list RPC.
 * Key = sku::warehouse::location
 * Delta convention: positive = return to inventory, negative = deduct from inventory
 */
interface Item {
  sku: string;
  warehouse: string;
  location: string;
  pickingQty: number;
  sku_not_found?: boolean;
}

interface DeltaEntry {
  sku: string;
  warehouse: string;
  location: string;
  delta: number;
}

function buildMap(items: Item[]): Map<string, { sku: string; warehouse: string; location: string; qty: number }> {
  const map = new Map<string, { sku: string; warehouse: string; location: string; qty: number }>();
  for (const item of items) {
    if (item.sku_not_found) continue;
    if (item.pickingQty <= 0) continue;
    const key = `${item.sku}::${item.warehouse}::${item.location || ''}`;
    const existing = map.get(key);
    if (existing) {
      existing.qty += item.pickingQty;
    } else {
      map.set(key, { sku: item.sku, warehouse: item.warehouse, location: item.location || '', qty: item.pickingQty });
    }
  }
  return map;
}

export function calculateReopenDelta(snapshot: Item[], current: Item[]): DeltaEntry[] {
  const snapMap = buildMap(snapshot);
  const currMap = buildMap(current);
  const deltas: DeltaEntry[] = [];

  // Items in snapshot: check if removed or qty changed
  for (const [key, snap] of snapMap) {
    const curr = currMap.get(key);
    let delta: number;
    if (!curr) {
      // Item removed → return full qty
      delta = snap.qty;
    } else {
      // delta = snapshot - current (positive = return, negative = deduct)
      delta = snap.qty - curr.qty;
    }
    if (delta !== 0) {
      deltas.push({ sku: snap.sku, warehouse: snap.warehouse, location: snap.location, delta });
    }
  }

  // Items in current but NOT in snapshot: newly added, deduct
  for (const [key, curr] of currMap) {
    if (!snapMap.has(key) && curr.qty > 0) {
      deltas.push({ sku: curr.sku, warehouse: curr.warehouse, location: curr.location, delta: -curr.qty });
    }
  }

  return deltas;
}

describe('calculateReopenDelta', () => {
  const makeItem = (sku: string, qty: number, location = 'ROW A'): Item => ({
    sku, warehouse: 'LUDLOW', location, pickingQty: qty,
  });

  it('returns empty array when no changes', () => {
    const items = [makeItem('SKU-A', 5), makeItem('SKU-B', 3)];
    expect(calculateReopenDelta(items, items)).toEqual([]);
  });

  it('returns positive delta when item is removed (return to inventory)', () => {
    const snapshot = [makeItem('SKU-A', 5), makeItem('SKU-B', 3)];
    const current = [makeItem('SKU-A', 5)]; // B removed
    const deltas = calculateReopenDelta(snapshot, current);
    expect(deltas).toEqual([
      { sku: 'SKU-B', warehouse: 'LUDLOW', location: 'ROW A', delta: 3 },
    ]);
  });

  it('returns negative delta when item is added (deduct from inventory)', () => {
    const snapshot = [makeItem('SKU-A', 5)];
    const current = [makeItem('SKU-A', 5), makeItem('SKU-C', 4)]; // C added
    const deltas = calculateReopenDelta(snapshot, current);
    expect(deltas).toEqual([
      { sku: 'SKU-C', warehouse: 'LUDLOW', location: 'ROW A', delta: -4 },
    ]);
  });

  it('returns positive delta when quantity decreased (return difference)', () => {
    const snapshot = [makeItem('SKU-A', 5)];
    const current = [makeItem('SKU-A', 3)]; // decreased by 2
    const deltas = calculateReopenDelta(snapshot, current);
    expect(deltas).toEqual([
      { sku: 'SKU-A', warehouse: 'LUDLOW', location: 'ROW A', delta: 2 },
    ]);
  });

  it('returns negative delta when quantity increased (deduct difference)', () => {
    const snapshot = [makeItem('SKU-A', 3)];
    const current = [makeItem('SKU-A', 5)]; // increased by 2
    const deltas = calculateReopenDelta(snapshot, current);
    expect(deltas).toEqual([
      { sku: 'SKU-A', warehouse: 'LUDLOW', location: 'ROW A', delta: -2 },
    ]);
  });

  it('handles swap (remove old + add new)', () => {
    const snapshot = [makeItem('SKU-A', 5), makeItem('SKU-B', 3)];
    const current = [makeItem('SKU-A', 5), makeItem('SKU-C', 3)]; // B swapped for C
    const deltas = calculateReopenDelta(snapshot, current);
    expect(deltas).toHaveLength(2);
    expect(deltas).toContainEqual({ sku: 'SKU-B', warehouse: 'LUDLOW', location: 'ROW A', delta: 3 }); // return B
    expect(deltas).toContainEqual({ sku: 'SKU-C', warehouse: 'LUDLOW', location: 'ROW A', delta: -3 }); // deduct C
  });

  it('handles multiple simultaneous changes', () => {
    const snapshot = [
      makeItem('SKU-A', 5),
      makeItem('SKU-B', 3),
      makeItem('SKU-C', 2),
    ];
    const current = [
      makeItem('SKU-A', 3),  // decreased by 2
      // SKU-B removed
      makeItem('SKU-C', 2),  // unchanged
      makeItem('SKU-D', 4),  // new
    ];
    const deltas = calculateReopenDelta(snapshot, current);
    expect(deltas).toHaveLength(3);
    expect(deltas).toContainEqual({ sku: 'SKU-A', warehouse: 'LUDLOW', location: 'ROW A', delta: 2 });
    expect(deltas).toContainEqual({ sku: 'SKU-B', warehouse: 'LUDLOW', location: 'ROW A', delta: 3 });
    expect(deltas).toContainEqual({ sku: 'SKU-D', warehouse: 'LUDLOW', location: 'ROW A', delta: -4 });
  });

  it('skips items with sku_not_found flag', () => {
    const snapshot = [makeItem('SKU-A', 5), { ...makeItem('SKU-B', 3), sku_not_found: true }];
    const current = [makeItem('SKU-A', 5)];
    const deltas = calculateReopenDelta(snapshot, current);
    expect(deltas).toEqual([]); // B was sku_not_found, A unchanged
  });

  it('uses composite key (sku + warehouse + location)', () => {
    const snapshot = [makeItem('SKU-A', 5, 'ROW A'), makeItem('SKU-A', 3, 'ROW B')];
    const current = [makeItem('SKU-A', 5, 'ROW A')]; // ROW B removed
    const deltas = calculateReopenDelta(snapshot, current);
    expect(deltas).toEqual([
      { sku: 'SKU-A', warehouse: 'LUDLOW', location: 'ROW B', delta: 3 },
    ]);
  });

  it('handles empty snapshot (all items are new)', () => {
    const snapshot: Item[] = [];
    const current = [makeItem('SKU-A', 5)];
    const deltas = calculateReopenDelta(snapshot, current);
    expect(deltas).toEqual([
      { sku: 'SKU-A', warehouse: 'LUDLOW', location: 'ROW A', delta: -5 },
    ]);
  });

  it('handles empty current (all items removed)', () => {
    const snapshot = [makeItem('SKU-A', 5), makeItem('SKU-B', 3)];
    const current: Item[] = [];
    const deltas = calculateReopenDelta(snapshot, current);
    expect(deltas).toHaveLength(2);
    expect(deltas).toContainEqual({ sku: 'SKU-A', warehouse: 'LUDLOW', location: 'ROW A', delta: 5 });
    expect(deltas).toContainEqual({ sku: 'SKU-B', warehouse: 'LUDLOW', location: 'ROW A', delta: 3 });
  });
});
