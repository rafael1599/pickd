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

  it('never uses a fast square of another row for overflow, and reports what found no room', () => {
    // Fill every buried square of the zone. ROW 20 is an edge row (all ten squares fast
    // and free), so the line widens across its own row first: 10 × 30 = 300 of 400.
    const buried = model.validCells.filter((c) => !c.isFast);
    const rows = buried.map((c, i) => line(`ROW ${c.row.num}`, `FILL-${i}`, 30, [c.letter]));
    rows.push(line('ROW 20', '03-BIG', 400, ['A']));
    const stock = zoneStock(ZONES.bay3_north, model, rows);
    const d = distribute(stock, model, plannedState(stock, []));
    expect(d.drafts.filter((m) => m.kind === 'move')).toEqual([]);
    expect(d.drafts[0].toLetters).toHaveLength(10);
    expect(d.leftovers).toEqual([{ sku: '03-BIG', location: 'ROW 20', qty: 400 - 30 * 10 }]);
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
