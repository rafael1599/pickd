// PRD warehouse-map-plan-and-live, the four rules and the revalidation —
// on real rows from prod (28 Aug 2026).

import { describe, it, expect } from 'vitest';
import {
  plannedState,
  planDrop,
  holdEntry,
  holdRow,
  holdOccupant,
  validateMove,
  summarizeMoves,
  describeMove,
  targetKey,
  type PlanMove,
} from '../slotPlan';
import { zoneStock, type StockRow } from '../../stock/rowStock';
import { ZONES, calculateLayout, defaultEngineState } from '../../engine';

let nextId = 1;
const line = (
  location: string,
  sku: string,
  quantity: number,
  sublocation: string[] | null
): StockRow => ({
  id: nextId++,
  sku,
  itemName: null,
  location,
  warehouse: 'LUDLOW',
  sublocation,
  quantity,
});

const model = calculateLayout(ZONES.bay3_north, defaultEngineState())!;
const rows = [
  line('ROW 33', '06-4735BK', 142, ['A']), // id 1
  line('ROW 33', '03-3983GY', 230, ['C']), // id 2
  line('ROW 33', '03-3777RD', 21, ['K']), // id 3 — no slot K on this plan
  line('ROW 27', '03-4071BL', 53, ['K']), // id 4
  ...Array.from({ length: 3 }, (_, i) => line('ROW 20', `01-05${10 + i}`, 1, ['G'])), // ids 5-7, a parts shelf
];
const stock = zoneStock(ZONES.bay3_north, model, rows);

let moveId = 100;
const asMove = (
  d: Omit<PlanMove, 'id' | 'planId' | 'position' | 'status' | 'error'>,
  position = 1
): PlanMove => ({
  ...d,
  id: moveId++,
  planId: 'p',
  position,
  status: 'planned',
  error: null,
});

describe('V1 — 33-A dropped on 33-C, one line there: a swap', () => {
  const held = holdEntry(stock.cells.get('33-A')!.entries[0], '33-A');
  const r = planDrop(held, { rowNum: '33', letter: 'C' }, plannedState(stock, []), []);

  it('plans two relabels, A→C and C→A', () => {
    expect(r.rule).toBe('swap');
    if (r.rule === 'noop') throw new Error('unreachable');
    expect(r.drafts.map((d) => [d.sku, d.toLetter, d.kind])).toEqual([
      ['06-4735BK', 'C', 'relabel'],
      ['03-3983GY', 'A', 'relabel'],
    ]);
    expect(r.removals).toEqual([]);
  });

  it('the planned state shows both ghosts and both origins vacated', () => {
    if (r.rule === 'noop') throw new Error('unreachable');
    const moves = r.drafts.map((d, i) => asMove(d, i + 1));
    const st = plannedState(stock, moves);
    expect(st.ghosts.get('33-C')!.map((m) => m.sku)).toEqual(['06-4735BK']);
    expect(st.ghosts.get('33-A')!.map((m) => m.sku)).toEqual(['03-3983GY']);
    expect(st.vacated).toEqual(new Set([1, 2]));
    expect(st.occupancy('33-C').map((o) => [o.sku, o.ghost !== null])).toEqual([
      ['06-4735BK', true],
    ]);
  });
});

describe('V2 — an unplaced line (33-K) dropped on an empty square', () => {
  it('is one relabel, K → D, and the drop rule is move', () => {
    const held = holdRow(rows[2]);
    const r = planDrop(held, { rowNum: '33', letter: 'D' }, plannedState(stock, []), []);
    expect(r.rule).toBe('move');
    if (r.rule === 'noop') throw new Error('unreachable');
    expect(r.drafts).toHaveLength(1);
    expect(r.drafts[0]).toMatchObject({
      sku: '03-3777RD',
      fromSublocation: ['K'],
      toLocation: 'ROW 33',
      toLetter: 'D',
      kind: 'relabel',
    });
    expect(targetKey(r.drafts[0])).toBe('33-D');
  });

  it('dropped on a taken square it joins, because it has no square to swap with', () => {
    const held = holdRow(rows[2]);
    const r = planDrop(held, { rowNum: '33', letter: 'C' }, plannedState(stock, []), []);
    expect(r.rule).toBe('join');
  });
});

describe('V3 — 27-K to 30-E is a move across rows', () => {
  it("plans a move with the line's whole quantity", () => {
    const held = holdRow(rows[3]);
    const r = planDrop(held, { rowNum: '30', letter: 'E' }, plannedState(stock, []), []);
    if (r.rule === 'noop') throw new Error('unreachable');
    expect(r.drafts[0]).toMatchObject({
      kind: 'move',
      qty: 53,
      fromLocation: 'ROW 27',
      toLocation: 'ROW 30',
      toLetter: 'E',
    });
  });
});

describe('V4 — dropped on a parts shelf it joins, nobody moves', () => {
  it('one move, no swap', () => {
    const held = holdEntry(stock.cells.get('33-A')!.entries[0], '33-A');
    const r = planDrop(held, { rowNum: '20', letter: 'G' }, plannedState(stock, []), []);
    expect(r.rule).toBe('join');
    if (r.rule === 'noop') throw new Error('unreachable');
    expect(r.drafts).toHaveLength(1);
    expect(r.drafts[0].kind).toBe('move');
  });
});

describe('undoing by dropping back home', () => {
  it('sending a planned line to its live square removes its move instead of adding one', () => {
    const held = holdEntry(stock.cells.get('33-A')!.entries[0], '33-A');
    const first = planDrop(held, { rowNum: '33', letter: 'D' }, plannedState(stock, []), []);
    if (first.rule === 'noop') throw new Error('unreachable');
    const moves = [asMove(first.drafts[0])];
    // Pick it up again from its ghost and drop it where it lives.
    const st = plannedState(stock, moves);
    const ghost = st.occupancy('33-D')[0];
    const back = planDrop(holdOccupant(ghost), { rowNum: '33', letter: 'A' }, st, moves);
    expect(back.rule).toBe('move');
    if (back.rule === 'noop') throw new Error('unreachable');
    expect(back.drafts).toEqual([]);
    expect(back.removals).toEqual([moves[0].id]);
  });

  it('dropping on the square it already sits in does nothing', () => {
    const held = holdEntry(stock.cells.get('33-A')!.entries[0], '33-A');
    expect(planDrop(held, { rowNum: '33', letter: 'A' }, plannedState(stock, []), []).rule).toBe(
      'noop'
    );
  });
});

describe('V6 / V7 — revalidation before executing', () => {
  const move = asMove({
    inventoryId: 4,
    sku: '03-4071BL',
    qty: 53,
    itemName: null,
    warehouse: 'LUDLOW',
    fromLocation: 'ROW 27',
    fromSublocation: ['K'],
    toLocation: 'ROW 30',
    toLetter: 'E',
    kind: 'move',
  });
  const relabel = asMove({
    inventoryId: 1,
    sku: '06-4735BK',
    qty: 142,
    itemName: null,
    warehouse: 'LUDLOW',
    fromLocation: 'ROW 33',
    fromSublocation: ['A'],
    toLocation: 'ROW 33',
    toLetter: 'C',
    kind: 'relabel',
  });

  it('a move whose quantity changed is skipped with the units left', () => {
    expect(
      validateMove(move, {
        id: 4,
        is_active: true,
        quantity: 40,
        location: 'ROW 27',
        sublocation: ['K'],
      })
    ).toEqual({ ok: false, reason: 'changed since planned · 40 u left' });
  });

  it('a line that left its row is skipped, never executed against another row', () => {
    expect(
      validateMove(relabel, {
        id: 1,
        is_active: true,
        quantity: 142,
        location: 'ROW 30',
        sublocation: ['E'],
      })
    ).toEqual({ ok: false, reason: 'line no longer in ROW 33' });
  });

  it('a relabel survives a quantity change; a line gone from stock does not', () => {
    expect(
      validateMove(relabel, {
        id: 1,
        is_active: true,
        quantity: 122,
        location: 'ROW 33',
        sublocation: ['A'],
      })
    ).toEqual({ ok: true });
    expect(validateMove(relabel, null).ok).toBe(false);
    expect(
      validateMove(relabel, {
        id: 1,
        is_active: false,
        quantity: 0,
        location: 'ROW 33',
        sublocation: ['A'],
      }).ok
    ).toBe(false);
    expect(
      validateMove(relabel, {
        id: 1,
        is_active: true,
        quantity: 142,
        location: 'ROW 33',
        sublocation: ['C'],
      })
    ).toEqual({ ok: false, reason: 'already there' });
  });

  it('summarises and describes', () => {
    expect(summarizeMoves([move, relabel])).toEqual({ count: 2, units: 195, rows: 3 });
    expect(describeMove(relabel)).toBe('ROW 33 A → ROW 33 C');
    expect(describeMove({ ...move, fromSublocation: null })).toBe('ROW 27 → ROW 30 E');
  });
});
