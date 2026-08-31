// PRD warehouse-map-plan-and-live, the four rules and the revalidation —
// on real rows from prod (28 Aug 2026).

import { describe, it, expect } from 'vitest';
import {
  OVERFLOW_LOCATION,
  plannedState,
  planDrop,
  holdEntry,
  holdRow,
  holdOccupant,
  validateMove,
  summarizeMoves,
  describeMove,
  targetKeys,
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
    expect(r.drafts.map((d) => [d.sku, d.toLetters[0], d.kind])).toEqual([
      ['06-4735BK', 'C', 'relabel'],
      ['03-3983GY', 'A', 'relabel'],
    ]);
    expect(r.removals).toEqual([]);
  });

  it('the planned state shows both ghosts and both origins vacated', () => {
    if (r.rule === 'noop') throw new Error('unreachable');
    const moves = r.drafts.map((d, i) => asMove(d, i + 1));
    const st = plannedState(stock, moves);
    expect(st.ghosts.get('33-C')!.map((g) => g.move.sku)).toEqual(['06-4735BK']);
    expect(st.ghosts.get('33-A')!.map((g) => g.move.sku)).toEqual(['03-3983GY']);
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
      toLetters: ['D'],
      kind: 'relabel',
    });
    expect(targetKeys(r.drafts[0])).toEqual(['33-D']);
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
      toLetters: ['E'],
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

describe('V8 — the same SKU picked twice moves square by square (31 Aug 2026)', () => {
  // Rafael: moving the SKU a second time (C→D, then F→G) redirected the first
  // move — "se vuelve a mover el que estaba en b, no el que yo quiero mover".
  // The hand holds one square's pallet; a second pick adds a move, and only
  // re-picking a ghost redirects that ghost's own move.
  const spread = [line('ROW 31', '03-4038BL', 60, ['A', 'B'])];
  const sStock = zoneStock(ZONES.bay3_north, model, spread);
  const id = spread[0].id;

  it("the hand takes one square's share; a second drop adds a move instead of redirecting", () => {
    const st0 = plannedState(sStock, []);
    const first = planDrop(
      holdOccupant(st0.occupancy('31-B')[0]),
      { rowNum: '31', letter: 'D' },
      st0,
      []
    );
    if (first.rule === 'noop') throw new Error('unreachable');
    expect(first.drafts).toEqual([
      expect.objectContaining({ qty: 30, fromSublocation: ['B'], toLetters: ['D'] }),
    ]);
    const moves = [asMove(first.drafts[0])];

    const st1 = plannedState(sStock, moves);
    // B empties once the plan runs; A still holds its pallet.
    expect(st1.gone('31-B', id)).toBe(true);
    expect(st1.gone('31-A', id)).toBe(false);
    expect(st1.unitsAt('31-A')).toBe(30);
    expect(st1.unitsAt('31-D')).toBe(30);
    expect(st1.occupancy('31-B')).toEqual([]);
    expect(st1.occupancy('31-A')).toHaveLength(1);

    const second = planDrop(
      holdOccupant(st1.occupancy('31-A')[0]),
      { rowNum: '31', letter: 'E' },
      st1,
      moves
    );
    if (second.rule === 'noop') throw new Error('unreachable');
    expect(second.removals).toEqual([]); // the first move stays as planned
    expect(second.drafts).toEqual([
      expect.objectContaining({ qty: 30, fromSublocation: ['A'], toLetters: ['E'] }),
    ]);
  });

  it("re-picking a ghost redirects only that ghost's move", () => {
    const st0 = plannedState(sStock, []);
    const first = planDrop(
      holdOccupant(st0.occupancy('31-B')[0]),
      { rowNum: '31', letter: 'D' },
      st0,
      []
    );
    if (first.rule === 'noop') throw new Error('unreachable');
    const moves = [asMove(first.drafts[0])];
    const st1 = plannedState(sStock, moves);
    const redirected = planDrop(
      holdOccupant(st1.occupancy('31-D')[0]),
      { rowNum: '31', letter: 'F' },
      st1,
      moves
    );
    if (redirected.rule === 'noop') throw new Error('unreachable');
    expect(redirected.removals).toEqual([moves[0].id]);
    expect(redirected.drafts).toEqual([
      expect.objectContaining({ qty: 30, toLetters: ['F'], kind: 'relabel' }),
    ]);
  });
});

describe('a square is what it will hold, not the stock of today (31 Aug 2026)', () => {
  // Rafael: "sigo viendo 209 en 3982bl" — ROW 30 G held 209 with 179 planned
  // out, and the square still painted 209 (over the cap, alarmed) because the
  // drawing read live stock and only dimmed it.
  const big = [line('ROW 30', '03-3982BL', 209, ['G'])];
  const bStock = zoneStock(ZONES.bay3_north, model, big);
  const partial = asMove({
    inventoryId: big[0].id,
    sku: '03-3982BL',
    qty: 179,
    itemName: null,
    warehouse: 'LUDLOW',
    fromLocation: 'ROW 30',
    fromSublocation: ['G'],
    toLocation: 'ROW 31',
    toLetters: ['B', 'C', 'D', 'E', 'F', 'G'],
    kind: 'move',
  });

  it('the origin keeps only what the move leaves, and the targets show their share', () => {
    const st = plannedState(bStock, [partial]);
    expect(st.unitsAt('30-G')).toBe(30);
    expect(st.remainingAt('30-G', big[0].id)).toBe(30);
    expect(st.unitsAt('31-B')).toBe(30);
    expect(st.occupancy('30-G').map((o) => o.qtyHere)).toEqual([30]);
  });

  it('a move of the whole square empties it', () => {
    const whole = { ...partial, qty: 209, toLetters: ['B', 'C', 'D', 'E', 'F', 'G', 'H'] };
    const st = plannedState(bStock, [whole]);
    expect(st.unitsAt('30-G')).toBe(0);
    expect(st.occupancy('30-G')).toEqual([]);
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
    toLetters: ['E'],
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
    toLetters: ['C'],
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

  it('a move survives a line that grew — it takes the planned units and leaves the rest', () => {
    expect(
      validateMove(move, {
        id: 4,
        is_active: true,
        quantity: 80,
        location: 'ROW 27',
        sublocation: ['K'],
      })
    ).toEqual({ ok: true });
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
    // A place the drawing has no squares for is named alone (Rafael, 28 Aug: the
    // leftovers of block 30–33 go to the south main hall, booked as MAS).
    expect(
      describeMove({ ...move, fromSublocation: null, toLocation: OVERFLOW_LOCATION, toLetters: [] })
    ).toBe('ROW 27 → MAS');
  });
});

describe('a move to a place with no squares (MAS)', () => {
  // Rafael, 28 Aug 2026: what does not fit in block 30–33 goes to the main hall. The
  // drawing has no square for it: no ghost, and the line is gone from its square only
  // when the whole of it goes.
  const hallMove = (inventoryId: number, qty: number): PlanMove => ({
    id: 9,
    planId: 'p',
    position: 1,
    inventoryId,
    sku: '06-4731BK',
    qty,
    itemName: null,
    warehouse: 'LUDLOW',
    fromLocation: 'ROW 33',
    fromSublocation: ['B'],
    toLocation: OVERFLOW_LOCATION,
    toLetters: [],
    kind: 'move',
    status: 'planned',
    error: null,
  });

  it('draws no ghost and keeps a partially moved line in its square', () => {
    const rows = [line('ROW 33', '06-4731BK', 132, ['B'])];
    const stock = zoneStock(ZONES.bay3_north, model, rows);
    const st = plannedState(stock, [hallMove(rows[0].id, 12)]);
    expect(st.ghosts.size).toBe(0);
    expect(st.vacated.has(rows[0].id)).toBe(false);
  });

  it('vacates the square when the whole line goes', () => {
    const rows = [line('ROW 32', '03-3885BK', 1, ['A'])];
    const stock = zoneStock(ZONES.bay3_north, model, rows);
    const st = plannedState(stock, [hallMove(rows[0].id, 1)]);
    expect(st.ghosts.size).toBe(0);
    expect(st.vacated.has(rows[0].id)).toBe(true);
  });
});
