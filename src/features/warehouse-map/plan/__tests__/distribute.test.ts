// DISTRIBUTE: 30 a square; a row's own free squares first, then free buried
// squares in the nearest rows for what does not fit; nothing forced.

import { describe, it, expect } from 'vitest';
import { distribute } from '../distribute';
import { plannedState } from '../slotPlan';
import { zoneStock, type StockRow } from '../../stock/rowStock';
import { ZONES, calculateLayout, defaultEngineState } from '../../engine';

let nextId = 1;
const line = (
  location: string,
  sku: string,
  quantity: number,
  sublocation: string[]
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

describe('a line with more units than squares', () => {
  it('spreads over the free squares of its own row, deeper first', () => {
    const rows = [line('ROW 33', '06-4731BK', 132, ['C'])];
    const stock = zoneStock(ZONES.bay3_north, model, rows);
    const d = distribute(stock, model, plannedState(stock, []));
    expect(d.drafts).toHaveLength(1);
    expect(d.drafts[0]).toMatchObject({
      kind: 'relabel',
      qty: 132,
      fromSublocation: ['C'],
      toLocation: 'ROW 33',
      toLetters: ['C', 'D', 'E', 'F', 'G'],
    });
    expect(d.leftovers).toEqual([]);
  });

  it('leaves a line alone when its squares already hold it', () => {
    const rows = [
      line('ROW 33', '06-4731BK', 60, ['A', 'B']),
      line('ROW 33', '03-3777RD', 21, ['C']),
    ];
    const stock = zoneStock(ZONES.bay3_north, model, rows);
    const d = distribute(stock, model, plannedState(stock, []));
    expect(d.drafts).toEqual([]);
    expect(d.untouched).toBe(2);
  });

  it('sends what its row cannot hold to free buried squares in the nearest row, as a partial move', () => {
    // ROW 33 is ten deep; 230 units need 8 squares and there are only 7 free after C.
    const rows = [
      line('ROW 33', '03-3983GY', 230, ['C']),
      ...['A', 'B'].map((l) => line('ROW 33', `03-4000${l}`, 10, [l])),
      line('ROW 33', '03-4212GY', 17, ['J']),
    ];
    const stock = zoneStock(ZONES.bay3_north, model, rows);
    const d = distribute(stock, model, plannedState(stock, []));
    const relabel = d.drafts.find((m) => m.kind === 'relabel')!;
    expect(relabel.toLetters).toEqual(['C', 'D', 'E', 'F', 'G', 'H', 'I']);
    const move = d.drafts.find((m) => m.kind === 'move')!;
    // 230 − 7 × 30 = 20 units to one buried square in ROW 32 (the nearest row).
    expect(move).toMatchObject({ qty: 20, toLocation: 'ROW 32', toLetters: ['B'] });
    expect(d.leftovers).toEqual([]);
  });

  it('uses a fast square only when no buried one is left, and says so', () => {
    // Fill every buried square of the zone. ROW 20 is an edge row (all ten squares fast
    // and free), so the line widens across its own row first: 10 × 30 = 300 of 400; the
    // last 100 have only fast squares left to go to.
    const buried = model.validCells.filter((c) => !c.isFast);
    const rows = buried.map((c, i) => line(`ROW ${c.row.num}`, `FILL-${i}`, 30, [c.letter]));
    rows.push(line('ROW 20', '03-BIG', 400, ['A']));
    const stock = zoneStock(ZONES.bay3_north, model, rows);
    const d = distribute(stock, model, plannedState(stock, []));
    expect(d.drafts[0].toLetters).toHaveLength(10);
    // Each move takes what one row can give (an inner row has two fast squares).
    const moves = d.drafts.filter((m) => m.kind === 'move');
    expect(moves.reduce((s, m) => s + m.qty, 0)).toBe(100);
    expect(d.onFast).toBe(moves.length);
    expect(d.leftovers).toEqual([]);
  });

  it('reports what found no square at all', () => {
    const all = model.validCells.map((c, i) =>
      line(`ROW ${c.row.num}`, `FILL-${i}`, 30, [c.letter])
    );
    // Every square taken; a line with no letter and 50 units has nowhere to go.
    all.push(line('ROW 33', '03-K', 50, []));
    const stock = zoneStock(ZONES.bay3_north, model, all);
    const d = distribute(stock, model, plannedState(stock, []));
    expect(d.leftovers).toMatchObject([{ sku: '03-K', location: 'ROW 33', qty: 50 }]);
  });

  it('gives a line with no letter a square in its own row, and leaves a line in K alone', () => {
    // K is a real position past J on the floor, valid for now (Rafael, 28 Aug 2026):
    // not drawn, not distributed.
    const rows = [line('ROW 33', '03-3777RD', 21, ['K']), line('ROW 32', '03-X', 27, [])];
    const stock = zoneStock(ZONES.bay3_north, model, rows);
    const d = distribute(stock, model, plannedState(stock, []));
    expect(d.drafts.map((m) => [m.sku, m.kind, m.toLocation, m.toLetters])).toEqual([
      ['03-X', 'relabel', 'ROW 32', ['A']],
    ]);
    expect(d.drafts[0].fromSublocation).toEqual([]);
  });

  it('packs small lines with no letter into one shared square', () => {
    const rows = Array.from({ length: 10 }, (_, i) => line('ROW 32', `01-05${10 + i}`, 1, []));
    const stock = zoneStock(ZONES.bay3_north, model, rows);
    const d = distribute(stock, model, plannedState(stock, []));
    expect(d.drafts).toHaveLength(10);
    expect(new Set(d.drafts.map((m) => m.toLetters.join())).size).toBe(1);
    expect(d.drafts.every((m) => m.kind === 'relabel' && m.toLocation === 'ROW 32')).toBe(true);
  });

  it('skips lines that already have a planned move', () => {
    const rows = [line('ROW 33', '06-4731BK', 132, ['C'])];
    const stock = zoneStock(ZONES.bay3_north, model, rows);
    const state = plannedState(stock, [
      {
        id: 1,
        planId: 'p',
        position: 1,
        inventoryId: rows[0].id,
        sku: '06-4731BK',
        qty: 132,
        itemName: null,
        warehouse: 'LUDLOW',
        fromLocation: 'ROW 33',
        fromSublocation: ['C'],
        toLocation: 'ROW 30',
        toLetters: ['A'],
        kind: 'move',
        status: 'planned',
        error: null,
      },
    ]);
    expect(distribute(stock, model, state).drafts).toEqual([]);
  });
});
