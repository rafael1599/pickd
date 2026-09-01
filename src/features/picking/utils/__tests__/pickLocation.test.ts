import { describe, it, expect } from 'vitest';
import {
  byPickPreference,
  collapseSplitForSku,
  isLastResort,
  planPickAcrossLocations,
  toPickingOrderMap,
} from '../pickLocation';

// Mirrors production: 42 BURIED is ranked out of the way, ROW 28 is a normal
// shelf, LUDLOW's PALLETIZED sits in the same last-resort band — and ATS has a
// PALLETIZED of its own that does not.
const order = toPickingOrderMap([
  { warehouse: 'LUDLOW', location: 'ROW 28', picking_order: 145 },
  { warehouse: 'LUDLOW', location: 'ROW 15', picking_order: 290 },
  { warehouse: 'LUDLOW', location: 'PALLETIZED', picking_order: 9995 },
  { warehouse: 'LUDLOW', location: '42 BURIED', picking_order: 9999 },
  { warehouse: 'LUDLOW', location: 'D2', picking_order: null },
  { warehouse: 'ATS', location: 'PALLETIZED', picking_order: 999 },
]);

const at = (location: string, warehouse = 'LUDLOW') => ({ warehouse, location });
const row = (location: string, quantity: number, warehouse = 'LUDLOW') => ({
  warehouse,
  location,
  quantity,
});

describe('isLastResort', () => {
  it('flags a deliberately deprioritised location', () => {
    expect(isLastResort(at('42 BURIED'), order)).toBe(true);
    expect(isLastResort(at('PALLETIZED'), order)).toBe(true);
  });

  it('does not flag a normal shelf', () => {
    expect(isLastResort(at('ROW 28'), order)).toBe(false);
  });

  // Half the warehouse has no picking_order, containers included. Demoting all
  // of them would move where nearly every pick is sourced from.
  it('does not flag an unranked location', () => {
    expect(isLastResort(at('D2'), order)).toBe(false);
    expect(isLastResort(at('SOMEWHERE ELSE'), order)).toBe(false);
  });

  it('flags nothing without the map', () => {
    expect(isLastResort(at('42 BURIED'))).toBe(false);
  });

  it('is case and whitespace insensitive', () => {
    expect(isLastResort({ warehouse: ' ludlow ', location: '  42 buried ' }, order)).toBe(true);
  });

  // The name is not unique. Keyed on it alone, whichever row the query returned
  // last decided the answer for both warehouses.
  it('does not let one warehouse decide the ranking of another', () => {
    expect(isLastResort(at('PALLETIZED', 'LUDLOW'), order)).toBe(true);
    expect(isLastResort(at('PALLETIZED', 'ATS'), order)).toBe(false);
  });

  // Safe side: an unmatched address is a normal shelf, as before this existed.
  it('does not flag an address whose warehouse is unknown', () => {
    expect(isLastResort({ location: 'PALLETIZED' }, order)).toBe(false);
  });
});

describe('byPickPreference', () => {
  // The reported case: 42 BURIED held 39 units against ROW 28's 17, won on
  // quantity, and pickers re-routed it by hand four times in eight days.
  it('prefers a normal shelf over a buried one holding more', () => {
    const rows = [row('42 BURIED', 39), row('ROW 28', 17)];
    expect([...rows].sort(byPickPreference(order))[0].location).toBe('ROW 28');
  });

  it('still takes the deepest stock among normal shelves', () => {
    const rows = [row('ROW 28', 5), row('ROW 15', 40)];
    expect([...rows].sort(byPickPreference(order))[0].location).toBe('ROW 15');
  });

  // Last resort means last, not never — once the normal shelves are dry it is
  // the only place the bike exists.
  it('falls back to the buried pallet when nothing else has stock', () => {
    const rows = [row('42 BURIED', 39)];
    expect([...rows].sort(byPickPreference(order))[0].location).toBe('42 BURIED');
  });

  it('orders last-resort locations among themselves by quantity', () => {
    const rows = [row('PALLETIZED', 2), row('42 BURIED', 39)];
    const sorted = [...rows].sort(byPickPreference(order));
    expect(sorted.map((r) => r.location)).toEqual(['42 BURIED', 'PALLETIZED']);
  });

  it('is the plain quantity sort without a map', () => {
    const rows = [row('ROW 28', 17), row('42 BURIED', 39)];
    expect([...rows].sort(byPickPreference())[0].location).toBe('42 BURIED');
  });

  it('treats an unranked container as a normal candidate', () => {
    const rows = [row('D2', 500), row('ROW 28', 17)];
    expect([...rows].sort(byPickPreference(order))[0].location).toBe('D2');
  });
});

describe('planPickAcrossLocations', () => {
  const plan = (rows: { location: string; quantity: number }[], qty: number, frozen?: string) =>
    planPickAcrossLocations(rows, qty, order, frozen);

  it('uses one stop when a reachable shelf covers the pick', () => {
    const p = plan([row('ROW 28', 17), row('42 BURIED', 39)], 12);
    expect(p.legs).toHaveLength(1);
    expect(p.legs[0]).toMatchObject({ location: 'ROW 28', qty: 12, available: 17 });
    expect(p.shortfall).toBe(0);
  });

  // The production case: 03-3931BK, ROW 28 holds 13 and 42 BURIED holds 39.
  // Before this, the pick was sent whole to a shelf that could not cover it.
  it('drains the reachable shelf first and takes only the remainder from buried', () => {
    const p = plan([row('ROW 28', 13), row('42 BURIED', 39)], 20);
    expect(p.legs).toEqual([
      { location: 'ROW 28', sublocation: null, qty: 13, available: 13, isLastResort: false },
      { location: '42 BURIED', sublocation: null, qty: 7, available: 39, isLastResort: true },
    ]);
    expect(p.shortfall).toBe(0);
  });

  // Fewer stops is normally better, but not at the cost of opening the pallet
  // that costs effort to dig out when a free shelf can absorb part of the job.
  it('does not take the whole pick from buried just because it fits there', () => {
    const p = plan([row('ROW 28', 13), row('42 BURIED', 39)], 20);
    expect(p.legs[0].location).toBe('ROW 28');
    expect(p.legs).toHaveLength(2);
  });

  it('splits across two reachable shelves when neither covers it alone', () => {
    const p = plan([row('ROW 28', 24), row('ROW 15', 10)], 30);
    expect(p.legs.map((l) => [l.location, l.qty])).toEqual([
      ['ROW 28', 24],
      ['ROW 15', 6],
    ]);
    expect(p.shortfall).toBe(0);
  });

  it('stays on the frozen shelf when it can do the whole job', () => {
    const p = plan([row('ROW 15', 40), row('ROW 28', 20)], 15, 'ROW 28');
    expect(p.legs).toHaveLength(1);
    expect(p.legs[0].location).toBe('ROW 28');
  });

  it('moves off the frozen shelf when it cannot, and one other shelf can', () => {
    const p = plan([row('ROW 28', 3), row('ROW 15', 40)], 15, 'ROW 28');
    expect(p.legs).toHaveLength(1);
    expect(p.legs[0].location).toBe('ROW 15');
  });

  it('reports what no shelf can cover instead of silently short-picking', () => {
    const p = plan([row('ROW 28', 5), row('42 BURIED', 4)], 20);
    expect(p.legs.reduce((s, l) => s + l.qty, 0)).toBe(9);
    expect(p.shortfall).toBe(11);
  });

  it('still uses the buried pallet when it is the only stock', () => {
    const p = plan([row('42 BURIED', 39)], 20);
    expect(p.legs).toEqual([
      { location: '42 BURIED', sublocation: null, qty: 20, available: 39, isLastResort: true },
    ]);
  });

  it('ignores empty rows', () => {
    const p = plan([row('ROW 28', 0), row('ROW 15', 8)], 5);
    expect(p.legs).toHaveLength(1);
    expect(p.legs[0].location).toBe('ROW 15');
  });

  it('plans nothing for a zero or missing qty', () => {
    expect(plan([row('ROW 28', 10)], 0)).toEqual({ legs: [], shortfall: 0 });
  });

  it('is all shortfall when the SKU has no stock at all', () => {
    expect(plan([], 6)).toEqual({ legs: [], shortfall: 6 });
  });

  // Without the map every shelf is equal, so this must not invent a split that
  // the old quantity-only behaviour would not have produced.
  it('falls back to the deepest shelf when no picking order is loaded', () => {
    const p = planPickAcrossLocations([row('ROW 28', 13), row('42 BURIED', 39)], 20);
    expect(p.legs).toHaveLength(1);
    expect(p.legs[0].location).toBe('42 BURIED');
  });

  it('carries the sublocation of each leg', () => {
    const p = planPickAcrossLocations(
      [
        { warehouse: 'LUDLOW', location: 'ROW 28', quantity: 13, sublocation: ['A'] },
        { warehouse: 'LUDLOW', location: '42 BURIED', quantity: 39, sublocation: ['C', 'D'] },
      ],
      20,
      order
    );
    expect(p.legs.map((l) => l.sublocation)).toEqual([['A'], ['C', 'D']]);
  });
});

describe('RETURN TO STOCK comes before every shelf', () => {
  // Units cancelled off an order sit on the floor until somebody walks them
  // back. The next order that needs the SKU is that walk (Rafael, 1 Sep 2026).
  it('sorts the returns floor first, however little it holds', () => {
    const rows = [row('ROW 28', 40), row('RETURN TO STOCK', 1), row('ROW 15', 9)];
    expect([...rows].sort(byPickPreference(order)).map((r) => r.location)).toEqual([
      'RETURN TO STOCK',
      'ROW 28',
      'ROW 15',
    ]);
  });

  it('needs no locations map to recognise it', () => {
    const rows = [row('ROW 28', 40), row('RETURN TO STOCK', 1)];
    expect([...rows].sort(byPickPreference()).map((r) => r.location)).toEqual([
      'RETURN TO STOCK',
      'ROW 28',
    ]);
  });

  it('takes it first and covers the rest from a shelf', () => {
    const plan = planPickAcrossLocations([row('ROW 28', 40), row('RETURN TO STOCK', 2)], 5, order);
    expect(plan.legs.map((l) => [l.location, l.qty])).toEqual([
      ['RETURN TO STOCK', 2],
      ['ROW 28', 3],
    ]);
    expect(plan.shortfall).toBe(0);
  });

  // The one-stop shortcut is what used to leave the floor untouched: a shelf
  // that covers the whole line alone won before anything else was considered.
  it('does not let a shelf that covers the line alone skip the floor', () => {
    const plan = planPickAcrossLocations([row('ROW 28', 40), row('RETURN TO STOCK', 1)], 3, order);
    expect(plan.legs.map((l) => l.location)).toEqual(['RETURN TO STOCK', 'ROW 28']);
  });

  it('is one stop when the floor covers the whole line', () => {
    const plan = planPickAcrossLocations([row('ROW 28', 40), row('RETURN TO STOCK', 6)], 4, order);
    expect(plan.legs.map((l) => [l.location, l.qty])).toEqual([['RETURN TO STOCK', 4]]);
  });

  // Staying put is a tie-break between shelves, not a way around the floor.
  it('beats frozenLocation', () => {
    const plan = planPickAcrossLocations(
      [row('ROW 28', 40), row('RETURN TO STOCK', 2)],
      5,
      order,
      'ROW 28'
    );
    expect(plan.legs[0].location).toBe('RETURN TO STOCK');
  });

  it('still falls back to the buried pallet for what is left', () => {
    const plan = planPickAcrossLocations(
      [row('RETURN TO STOCK', 1), row('ROW 15', 2), row('42 BURIED', 30)],
      10,
      order
    );
    expect(plan.legs.map((l) => [l.location, l.qty])).toEqual([
      ['RETURN TO STOCK', 1],
      ['ROW 15', 2],
      ['42 BURIED', 7],
    ]);
    expect(plan.shortfall).toBe(0);
  });
});

describe('collapseSplitForSku', () => {
  const split = (part: number, of: number, isLastResort = false) => ({
    part,
    of,
    totalQty: 20,
    isLastResort,
  });

  const legs = [
    { sku: '03-3931BK', location: 'ROW 28', pickingQty: 13, pickSplit: split(1, 2) },
    { sku: '03-3931BK', location: '42 BURIED', pickingQty: 7, pickSplit: split(2, 2, true) },
    { sku: '06-4427RB', location: 'ROW 4', pickingQty: 2 },
  ];

  // adjust_qty maps over every row matching the SKU. Left split, "set it to 5"
  // would write 5 onto both legs and ship 10.
  it('folds every leg into one row carrying the full quantity', () => {
    const out = collapseSplitForSku(legs, '03-3931BK');
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ sku: '03-3931BK', location: 'ROW 28', pickingQty: 20 });
    expect(out[0].pickSplit).toBeNull();
  });

  it('keeps the first stop, which is the reachable one', () => {
    expect(collapseSplitForSku(legs, '03-3931BK')[0].location).toBe('ROW 28');
  });

  it('leaves other SKUs exactly where they were', () => {
    const out = collapseSplitForSku(legs, '03-3931BK');
    expect(out[1]).toBe(legs[2]);
  });

  it('is a no-op for a SKU that was never split', () => {
    expect(collapseSplitForSku(legs, '06-4427RB')).toBe(legs);
  });

  it('is a no-op for a SKU that is not in the order', () => {
    expect(collapseSplitForSku(legs, '03-0000XX')).toBe(legs);
  });

  it('leaves a same-SKU row that carries no split tag alone', () => {
    const mixed = [
      { sku: 'A', location: 'ROW 1', pickingQty: 4 },
      { sku: 'A', location: 'ROW 2', pickingQty: 6 },
    ];
    expect(collapseSplitForSku(mixed, 'A')).toBe(mixed);
  });
});

describe('planPickAcrossLocations — sublocation passthrough', () => {
  it('carries the sublocation of each leg', () => {
    const p = planPickAcrossLocations(
      [
        { warehouse: 'LUDLOW', location: 'ROW 28', quantity: 13, sublocation: ['A'] },
        { warehouse: 'LUDLOW', location: '42 BURIED', quantity: 39, sublocation: ['C', 'D'] },
      ],
      20,
      order
    );
    expect(p.legs.map((l) => l.sublocation)).toEqual([['A'], ['C', 'D']]);
  });
});
