import { describe, it, expect } from 'vitest';
import { rebaseToActualStock, type StaleInventoryRow } from '../useStaleLocationCheck';

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
