import { describe, it, expect } from 'vitest';
import { rebaseToActualStock, type StaleInventoryRow } from '../useStaleLocationCheck';
import { toPickingOrderMap } from '../../utils/pickLocation';

const row = (
  sku: string,
  location: string | null,
  quantity: number,
  sublocation: string[] | null = null,
  is_active = true
): StaleInventoryRow => ({ sku, location, quantity, sublocation, is_active, warehouse: 'LUDLOW' });

interface TestItem {
  sku: string;
  location: string | null;
  warehouse: string;
  pickingQty: number;
  sublocation?: string[] | null;
  picked?: boolean;
  insufficient_stock?: boolean;
  pickSplit?: { part: number; of: number; totalQty: number; isLastResort: boolean } | null;
}

const item = (sku: string, location: string | null, extra: Partial<TestItem> = {}): TestItem => ({
  sku,
  location,
  warehouse: 'LUDLOW',
  pickingQty: 1,
  ...extra,
});

describe('rebaseToActualStock', () => {
  // The reported failure: someone consolidates ROW 14 into ROW 31 while the
  // order is being picked, and sending it to double-check reports no stock for
  // a bike that is on the shelf one row over.
  it('moves a pick to the row its stock was consolidated into', () => {
    const items = [item('03-4065BL', 'ROW 14')];
    const rows = [row('03-4065BL', 'ROW 14', 0), row('03-4065BL', 'ROW 31', 53, ['C'])];

    const { items: rebased, moves } = rebaseToActualStock(items, rows);

    expect(rebased[0].location).toBe('ROW 31');
    expect(rebased[0].sublocation).toEqual(['C']);
    expect(moves).toHaveLength(1);
    expect(moves[0]).toMatchObject({
      sku: '03-4065BL',
      frozenLocation: 'ROW 14',
      suggestedLocation: 'ROW 31',
      suggestedSublocation: ['C'],
      suggestedQty: 53,
    });
  });

  it('leaves a pick alone while its own location still has stock', () => {
    const items = [item('06-4427RB', 'ROW 4')];
    const rows = [row('06-4427RB', 'ROW 4', 10), row('06-4427RB', 'ROW 3', 5)];

    const { items: rebased, moves } = rebaseToActualStock(items, rows);

    expect(rebased[0].location).toBe('ROW 4');
    expect(moves).toHaveLength(0);
  });

  // Genuinely out of stock must stay out of stock — the guard downstream still
  // has to refuse it, so there is nothing to rebase onto.
  it('does not invent a location when the SKU is gone everywhere', () => {
    const items = [item('03-3768BL', 'ROW 34')];
    const rows = [row('03-3768BL', 'ROW 34', 0), row('03-3768BL', 'ROW 41', 0)];

    const { items: rebased, moves } = rebaseToActualStock(items, rows);

    expect(rebased[0].location).toBe('ROW 34');
    expect(moves).toHaveLength(0);
  });

  // A picked bike is on the pallet already. Rewriting its location reads to
  // compensate_picking_list_changes as a remove-and-re-add, which restores and
  // re-deducts stock for something that never moved.
  it('never moves an item that is already picked', () => {
    const items = [item('03-4065BL', 'ROW 14', { picked: true })];
    const rows = [row('03-4065BL', 'ROW 14', 0), row('03-4065BL', 'ROW 31', 53)];

    const { items: rebased, moves } = rebaseToActualStock(items, rows);

    expect(rebased[0].location).toBe('ROW 14');
    expect(moves).toHaveLength(0);
  });

  it('rebases only the moved item, leaving its neighbours untouched', () => {
    const items = [item('03-4065BL', 'ROW 14'), item('06-4427RB', 'ROW 4')];
    const rows = [
      row('03-4065BL', 'ROW 14', 0),
      row('03-4065BL', 'ROW 31', 53),
      row('06-4427RB', 'ROW 4', 10),
    ];

    const { items: rebased, moves } = rebaseToActualStock(items, rows);

    expect(rebased.map((i) => i.location)).toEqual(['ROW 31', 'ROW 4']);
    expect(moves).toHaveLength(1);
  });

  // A row emptied into an inactive/ghost placeholder is not somewhere to walk.
  it('ignores inactive rows when choosing the new location', () => {
    const items = [item('03-4065BL', 'ROW 14')];
    const rows = [row('03-4065BL', 'ROW 14', 0), row('03-4065BL', 'ROW 31', 5, null, false)];

    const { items: rebased, moves } = rebaseToActualStock(items, rows);

    expect(rebased[0].location).toBe('ROW 14');
    expect(moves).toHaveLength(0);
  });

  it('returns the original array untouched when nothing moved', () => {
    const items = [item('06-4427RB', 'ROW 4')];
    const rows = [row('06-4427RB', 'ROW 4', 10)];

    const { items: rebased } = rebaseToActualStock(items, rows);

    expect(rebased).toBe(items);
  });

  // Consolidation splits happen; the picker should be sent to the deepest one.
  it('picks the location holding the most units', () => {
    const items = [item('03-4065BL', 'ROW 14')];
    const rows = [
      row('03-4065BL', 'ROW 14', 0),
      row('03-4065BL', 'ROW 20', 3),
      row('03-4065BL', 'ROW 31', 40),
    ];

    const { items: rebased } = rebaseToActualStock(items, rows);

    expect(rebased[0].location).toBe('ROW 31');
  });
});

describe('rebaseToActualStock — picks split across shelves', () => {
  const order = toPickingOrderMap([
    { warehouse: 'LUDLOW', location: 'ROW 28', picking_order: 145 },
    { warehouse: 'LUDLOW', location: 'ROW 15', picking_order: 290 },
    { warehouse: 'LUDLOW', location: '42 BURIED', picking_order: 9999 },
  ]);

  // Production shape of 03-3931BK: 13 reachable in ROW 28, 39 buried. A pick of
  // 20 used to be sent whole to ROW 28 — a shelf that cannot cover it — and the
  // picker finished the job by hand.
  it('splits one item into one row per stop', () => {
    const items = [item('03-3931BK', 'ROW 42', { pickingQty: 20 })];
    const rows = [
      row('03-3931BK', 'ROW 42', 0),
      row('03-3931BK', 'ROW 28', 13, ['B']),
      row('03-3931BK', '42 BURIED', 39),
    ];

    const { items: rebased, moves } = rebaseToActualStock(items, rows, order);

    expect(rebased).toHaveLength(2);
    expect(rebased.map((i) => [i.location, i.pickingQty])).toEqual([
      ['ROW 28', 13],
      ['42 BURIED', 7],
    ]);
    expect(rebased[0].sublocation).toEqual(['B']);
    expect(moves[0].legs.map((l) => l.qty)).toEqual([13, 7]);
  });

  // The case that used to read as a flat out-of-stock: the shelf the order was
  // built against still holds units, just not enough.
  it('splits when the frozen shelf has some of the pick but not all', () => {
    const items = [item('03-3931BK', 'ROW 28', { pickingQty: 20 })];
    const rows = [row('03-3931BK', 'ROW 28', 13), row('03-3931BK', '42 BURIED', 39)];

    const { items: rebased } = rebaseToActualStock(items, rows, order);

    expect(rebased.map((i) => [i.location, i.pickingQty])).toEqual([
      ['ROW 28', 13],
      ['42 BURIED', 7],
    ]);
  });

  it('tags each row so the card can say which stop it is', () => {
    const items = [item('03-3931BK', 'ROW 28', { pickingQty: 20 })];
    const rows = [row('03-3931BK', 'ROW 28', 13), row('03-3931BK', '42 BURIED', 39)];

    const { items: rebased } = rebaseToActualStock(items, rows, order);

    expect(rebased[0].pickSplit).toEqual({
      part: 1,
      of: 2,
      totalQty: 20,
      isLastResort: false,
    });
    expect(rebased[1].pickSplit).toEqual({
      part: 2,
      of: 2,
      totalQty: 20,
      isLastResort: true,
    });
  });

  // The alarm was about the shelf, not the warehouse. Once the route covers the
  // order, keeping the flag would block a pick that is entirely fillable.
  it('clears insufficient_stock once the route covers the order', () => {
    const items = [item('03-3931BK', 'ROW 28', { pickingQty: 20, insufficient_stock: true })];
    const rows = [row('03-3931BK', 'ROW 28', 13), row('03-3931BK', '42 BURIED', 39)];

    const { items: rebased } = rebaseToActualStock(items, rows, order);

    expect(rebased.every((i) => i.insufficient_stock === false)).toBe(true);
  });

  it('keeps insufficient_stock when even the full route falls short', () => {
    const items = [item('03-3931BK', 'ROW 28', { pickingQty: 20, insufficient_stock: true })];
    const rows = [row('03-3931BK', 'ROW 28', 5), row('03-3931BK', '42 BURIED', 4)];

    const { items: rebased, moves } = rebaseToActualStock(items, rows, order);

    expect(moves[0].shortfall).toBe(11);
    expect(rebased.every((i) => i.insufficient_stock === true)).toBe(true);
  });

  it('does not split when one reachable shelf covers the whole pick', () => {
    const items = [item('03-3931BK', 'ROW 42', { pickingQty: 10 })];
    const rows = [
      row('03-3931BK', 'ROW 42', 0),
      row('03-3931BK', 'ROW 28', 13),
      row('03-3931BK', '42 BURIED', 39),
    ];

    const { items: rebased } = rebaseToActualStock(items, rows, order);

    expect(rebased).toHaveLength(1);
    expect(rebased[0].location).toBe('ROW 28');
    expect(rebased[0].pickSplit ?? undefined).toBeUndefined();
  });

  it('leaves the pick alone when its own shelf still covers it', () => {
    const items = [item('03-3931BK', 'ROW 28', { pickingQty: 10 })];
    const rows = [row('03-3931BK', 'ROW 28', 13), row('03-3931BK', '42 BURIED', 39)];

    const { items: rebased, moves } = rebaseToActualStock(items, rows, order);

    expect(rebased).toBe(items);
    expect(moves).toHaveLength(0);
  });

  // A picked bike is on the pallet. Splitting it would read to
  // compensate_picking_list_changes as a remove-and-re-add.
  it('never splits an item that is already picked', () => {
    const items = [item('03-3931BK', 'ROW 28', { pickingQty: 20, picked: true })];
    const rows = [row('03-3931BK', 'ROW 28', 13), row('03-3931BK', '42 BURIED', 39)];

    const { items: rebased } = rebaseToActualStock(items, rows, order);

    expect(rebased).toHaveLength(1);
    expect(rebased[0].location).toBe('ROW 28');
  });

  it('splits across two reachable shelves, with no buried stock involved', () => {
    const items = [item('03-4085BK', 'ROW 28', { pickingQty: 30 })];
    const rows = [row('03-4085BK', 'ROW 28', 24), row('03-4085BK', 'ROW 15', 10)];

    const { items: rebased } = rebaseToActualStock(items, rows, order);

    expect(rebased.map((i) => [i.location, i.pickingQty])).toEqual([
      ['ROW 28', 24],
      ['ROW 15', 6],
    ]);
    expect(rebased.every((i) => i.pickSplit?.isLastResort === false)).toBe(true);
  });

  it('splits the neighbours of a split item without disturbing them', () => {
    const items = [
      item('03-3931BK', 'ROW 28', { pickingQty: 20 }),
      item('06-4427RB', 'ROW 4', { pickingQty: 2 }),
    ];
    const rows = [
      row('03-3931BK', 'ROW 28', 13),
      row('03-3931BK', '42 BURIED', 39),
      row('06-4427RB', 'ROW 4', 10),
    ];

    const { items: rebased } = rebaseToActualStock(items, rows, order);

    expect(rebased).toHaveLength(3);
    expect(rebased[2]).toMatchObject({ sku: '06-4427RB', location: 'ROW 4', pickingQty: 2 });
    expect(rebased[2].pickSplit).toBeUndefined();
  });
});

// An order can already name one SKU at two addresses — a split from an earlier
// pass, or an extra added by hand in Edit Order. Planning each row on its own
// let both of them claim the same units.
describe('rebaseToActualStock — one SKU already spread over two rows', () => {
  const order = toPickingOrderMap([
    { warehouse: 'LUDLOW', location: 'ROW 28', picking_order: 145 },
    { warehouse: 'LUDLOW', location: 'ROW 15', picking_order: 290 },
    { warehouse: 'LUDLOW', location: '42 BURIED', picking_order: 9999 },
  ]);

  const split = (part: number, of: number, isLastResort = false) => ({
    part,
    of,
    totalQty: 20,
    isLastResort,
  });

  it('leaves an intact split alone, so a second pass changes nothing', () => {
    const items = [
      item('03-3931BK', 'ROW 28', { pickingQty: 13, pickSplit: split(1, 2) }),
      item('03-3931BK', '42 BURIED', { pickingQty: 7, pickSplit: split(2, 2, true) }),
    ];
    const rows = [row('03-3931BK', 'ROW 28', 13), row('03-3931BK', '42 BURIED', 39)];

    const { items: rebased, moves } = rebaseToActualStock(items, rows, order);

    expect(rebased).toBe(items);
    expect(moves).toHaveLength(0);
  });

  // Both legs re-planned on their own would each be sent to ROW 15 as a
  // separate row. pick_item matches (sku, warehouse, location), so the second
  // one could never be checked off.
  it('does not emit two rows for the same address', () => {
    const items = [
      item('03-3931BK', 'ROW 28', { pickingQty: 13, pickSplit: split(1, 2) }),
      item('03-3931BK', '42 BURIED', { pickingQty: 7, pickSplit: split(2, 2, true) }),
    ];
    const rows = [
      row('03-3931BK', 'ROW 28', 0),
      row('03-3931BK', '42 BURIED', 0),
      row('03-3931BK', 'ROW 15', 50),
    ];

    const { items: rebased } = rebaseToActualStock(items, rows, order);

    expect(rebased).toHaveLength(1);
    expect(rebased[0]).toMatchObject({ location: 'ROW 15', pickingQty: 20 });
    expect(rebased[0].pickSplit).toBeNull();
  });

  // 13 + 7 against a shelf holding 15: planned separately both rows fit, and
  // the order walks away claiming 20 units from 15.
  it('plans the SKU once against the stock as a whole', () => {
    const items = [
      item('03-3931BK', 'ROW 28', { pickingQty: 13, pickSplit: split(1, 2) }),
      item('03-3931BK', '42 BURIED', { pickingQty: 7, pickSplit: split(2, 2, true) }),
    ];
    const rows = [
      row('03-3931BK', 'ROW 28', 0),
      row('03-3931BK', '42 BURIED', 0),
      row('03-3931BK', 'ROW 15', 15),
    ];

    const { items: rebased, moves } = rebaseToActualStock(items, rows, order);

    expect(rebased.reduce((sum, i) => sum + i.pickingQty, 0)).toBe(15);
    expect(moves[0].shortfall).toBe(5);
  });

  it('re-splits the whole SKU when one of its shelves empties', () => {
    const items = [
      item('03-3931BK', 'ROW 28', { pickingQty: 13, pickSplit: split(1, 2) }),
      item('03-3931BK', '42 BURIED', { pickingQty: 7, pickSplit: split(2, 2, true) }),
    ];
    const rows = [
      row('03-3931BK', 'ROW 28', 0),
      row('03-3931BK', '42 BURIED', 39),
      row('03-3931BK', 'ROW 15', 12),
    ];

    const { items: rebased } = rebaseToActualStock(items, rows, order);

    expect(rebased.map((i) => [i.location, i.pickingQty])).toEqual([
      ['ROW 15', 12],
      ['42 BURIED', 8],
    ]);
    expect(rebased.map((i) => i.pickSplit?.part)).toEqual([1, 2]);
  });

  it('keeps a picked leg out of the replan and off the books', () => {
    const items = [
      item('03-3931BK', 'ROW 28', { pickingQty: 13, picked: true, pickSplit: split(1, 2) }),
      item('03-3931BK', '42 BURIED', { pickingQty: 7, pickSplit: split(2, 2, true) }),
    ];
    const rows = [row('03-3931BK', '42 BURIED', 0), row('03-3931BK', 'ROW 15', 30)];

    const { items: rebased } = rebaseToActualStock(items, rows, order);

    expect(rebased[0]).toMatchObject({ location: 'ROW 28', pickingQty: 13, picked: true });
    expect(rebased[1]).toMatchObject({ location: 'ROW 15', pickingQty: 7 });
  });
});
