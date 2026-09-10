import { describe, expect, it } from 'vitest';
import { planListsInTurn, sameAddresses, stockMinusClaims, type PlannableItem } from '../planPick';
import type { StaleInventoryRow } from '../../hooks/useStaleLocationCheck';

const row = (
  sku: string,
  location: string,
  quantity: number,
  sublocation: string[] | null = null
): StaleInventoryRow => ({ sku, warehouse: 'LUDLOW', location, quantity, sublocation });

const line = (sku: string, location: string | null, pickingQty: number): PlannableItem => ({
  sku,
  location,
  warehouse: 'LUDLOW',
  pickingQty,
});

// picking_order: lower walks first. RETURN TO STOCK is recognised by name, not
// by this number — see isReturnToStock.
const ORDER = new Map<string, number>([
  ['LUDLOW|ROW 1', 100],
  ['LUDLOW|ROW 8', 200],
  ['LUDLOW|ROW 13', 300],
  ['LUDLOW|RETURN TO STOCK', 420],
]);

describe('stockMinusClaims', () => {
  it('leaves the shelf alone when nobody claims it', () => {
    const rows = [row('A', 'ROW 1', 10)];
    expect(stockMinusClaims(rows, [])[0].quantity).toBe(10);
  });

  it('takes another order&apos;s claim off the shelf', () => {
    const rows = [row('A', 'ROW 1', 10)];
    const out = stockMinusClaims(rows, [line('A', 'ROW 1', 4)]);
    expect(out[0].quantity).toBe(6);
  });

  it('adds up several claims at the same address', () => {
    const rows = [row('A', 'ROW 1', 10)];
    const out = stockMinusClaims(rows, [line('A', 'ROW 1', 4), line('A', 'ROW 1', 3)]);
    expect(out[0].quantity).toBe(3);
  });

  it('never goes below zero', () => {
    const rows = [row('A', 'ROW 1', 2)];
    expect(stockMinusClaims(rows, [line('A', 'ROW 1', 9)])[0].quantity).toBe(0);
  });

  it('a claim on an address that no longer exists cannot empty a real shelf', () => {
    const rows = [row('A', 'ROW 1', 10)];
    const out = stockMinusClaims(rows, [line('A', 'GONE', 5)]);
    expect(out[0].quantity).toBe(10);
  });

  it('matches on sku and warehouse too, not just the location name', () => {
    const rows = [row('A', 'ROW 1', 10)];
    const out = stockMinusClaims(rows, [line('B', 'ROW 1', 5)]);
    expect(out[0].quantity).toBe(10);
  });
});

describe('planListsInTurn', () => {
  // The 9 sep 2026 shape: the shelf still covers the pick, so the drift guard
  // stays quiet, but a unit is sitting in RETURN TO STOCK and owes somebody a
  // trip. byPickPreference puts it ahead of any shelf.
  it('prefers RETURN TO STOCK over a shelf that could also cover it', () => {
    const rows = [row('03-3868BL', 'ROW 1', 10, ['D']), row('03-3868BL', 'RETURN TO STOCK', 1)];
    const [out] = planListsInTurn(
      [{ id: 'l1', items: [line('03-3868BL', 'ROW 1', 1)] }],
      rows,
      ORDER
    );
    expect(out.changed).toBe(true);
    expect(out.items[0].location).toBe('RETURN TO STOCK');
  });

  it('plans a line that arrived with no address at all', () => {
    const rows = [row('A', 'ROW 8', 5)];
    const [out] = planListsInTurn([{ id: 'l1', items: [line('A', null, 2)] }], rows, ORDER);
    expect(out.changed).toBe(true);
    expect(out.items[0].location).toBe('ROW 8');
  });

  it('says nothing changed when the frozen address is already the right one', () => {
    const rows = [row('A', 'ROW 1', 10)];
    const [out] = planListsInTurn([{ id: 'l1', items: [line('A', 'ROW 1', 2)] }], rows, ORDER);
    expect(out.changed).toBe(false);
  });

  it('leaves a genuine out-of-stock where it is instead of inventing a shelf', () => {
    const rows = [row('A', 'ROW 1', 0)];
    const [out] = planListsInTurn([{ id: 'l1', items: [line('A', 'ROW 1', 2)] }], rows, ORDER);
    expect(out.changed).toBe(false);
    expect(out.items[0].location).toBe('ROW 1');
  });

  // Two rows of one combined order must not both be sent to the same units.
  // (byPickPreference takes the deepest shelf first, so the 10 goes before the 3.)
  it('makes siblings take turns instead of both claiming the same shelf', () => {
    const rows = [row('A', 'ROW 13', 10), row('A', 'ROW 1', 3)];
    const out = planListsInTurn(
      [
        { id: 'l1', items: [line('A', null, 10)] },
        { id: 'l2', items: [line('A', null, 3)] },
      ],
      rows,
      ORDER
    );
    expect(out[0].items[0].location).toBe('ROW 13');
    // ROW 13 is spent by the first row, so the second is sent onward.
    expect(out[1].items[0].location).toBe('ROW 1');
  });

  it('reports the moves it made, for the picker to read', () => {
    const rows = [row('A', 'ROW 13', 5)];
    const [out] = planListsInTurn([{ id: 'l1', items: [line('A', 'ROW 8', 2)] }], rows, ORDER);
    expect(out.moves).toHaveLength(1);
    expect(out.moves[0]).toMatchObject({ sku: 'A', frozenLocation: 'ROW 8' });
    expect(out.moves[0].suggestedLocation).toBe('ROW 13');
  });

  it('an unplanned line reports an empty frozen location, not null', () => {
    const rows = [row('A', 'ROW 8', 5)];
    const [out] = planListsInTurn([{ id: 'l1', items: [line('A', null, 2)] }], rows, ORDER);
    expect(out.moves[0].frozenLocation).toBe('');
  });
});

describe('sameAddresses', () => {
  it('is true for an untouched plan', () => {
    const a = [line('A', 'ROW 1', 2)];
    expect(sameAddresses(a, [line('A', 'ROW 1', 2)])).toBe(true);
  });

  it('catches a moved shelf', () => {
    expect(sameAddresses([line('A', 'ROW 1', 2)], [line('A', 'ROW 8', 2)])).toBe(false);
  });

  it('catches a split that changed the quantity on a leg', () => {
    expect(sameAddresses([line('A', 'ROW 1', 5)], [line('A', 'ROW 1', 3)])).toBe(false);
  });

  it('catches a pick that became two stops', () => {
    expect(
      sameAddresses([line('A', 'ROW 1', 5)], [line('A', 'ROW 1', 3), line('A', 'ROW 8', 2)])
    ).toBe(false);
  });

  it('catches a sublocation change on the same shelf', () => {
    const before = [{ ...line('A', 'ROW 1', 2), sublocation: ['A'] }];
    const after = [{ ...line('A', 'ROW 1', 2), sublocation: ['D'] }];
    expect(sameAddresses(before, after)).toBe(false);
  });
});
