// DISTRIBUTE: 30 a square; a row's own free squares first, then free buried
// squares in the nearest rows for what does not fit; what finds no square
// goes to the MAIN HALL in front of its block — never over 30 in a square.

import { describe, it, expect } from 'vitest';
import { distribute, repairOverCap, spreadDrop } from '../distribute';
import { OVERFLOW_LOCATION, plannedState, type PlanMove } from '../slotPlan';
import { zoneStock, type StockRow } from '../../stock/rowStock';
import { ZONES, calculateLayout, defaultEngineState, slotKey } from '../../engine';

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
      origin: 'auto' as const,
      qty: 132,
      fromSublocation: ['C'],
      toLocation: 'ROW 33',
      toLetters: ['C', 'D', 'E', 'F', 'G'],
    });
    expect(d.toHall).toBe(0);
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
    // ROW 33 is ten deep plus K; 260 units need 9 squares and after C the row
    // itself has 7 free (D–I and K, J taken).
    const rows = [
      line('ROW 33', '03-3983GY', 260, ['C']),
      ...['A', 'B'].map((l) => line('ROW 33', `03-4000${l}`, 10, [l])),
      line('ROW 33', '03-4212GY', 17, ['J']),
    ];
    const stock = zoneStock(ZONES.bay3_north, model, rows);
    const d = distribute(stock, model, plannedState(stock, []));
    const relabel = d.drafts.find((m) => m.kind === 'relabel')!;
    expect(relabel.toLetters).toEqual(['C', 'D', 'E', 'F', 'G', 'H', 'I', 'K']);
    const move = d.drafts.find((m) => m.kind === 'move')!;
    // 260 − 8 × 30 = 20 units to one buried square in ROW 32 (the nearest row).
    expect(move).toMatchObject({ qty: 20, toLocation: 'ROW 32', toLetters: ['B'] });
    expect(d.toHall).toBe(0);
  });

  it('uses a fast square only when no buried one is left, and says so', () => {
    // Fill every buried square of the zone. ROW 20 is an edge row (all eleven squares,
    // K included, fast and free), so the line widens across its own row first:
    // 11 × 30 = 330 of 400; the last 70 have only fast squares left to go to.
    const buried = model.validCells.filter((c) => !c.isFast);
    const rows = buried.map((c, i) => line(`ROW ${c.row.num}`, `FILL-${i}`, 30, [c.letter]));
    rows.push(line('ROW 20', '03-BIG', 400, ['A']));
    const stock = zoneStock(ZONES.bay3_north, model, rows);
    const d = distribute(stock, model, plannedState(stock, []));
    expect(d.drafts[0].toLetters).toHaveLength(11);
    // Each move takes what one row can give (an inner row has two fast squares).
    const moves = d.drafts.filter((m) => m.kind === 'move');
    expect(moves.reduce((s, m) => s + m.qty, 0)).toBe(70);
    expect(d.onFast).toBe(moves.length);
    expect(d.toHall).toBe(0);
  });

  it('what finds no square at all goes to MAS, in front of its block', () => {
    const all = model.validCells.map((c, i) =>
      line(`ROW ${c.row.num}`, `FILL-${i}`, 30, [c.letter])
    );
    // Every square taken; a line with no letter and 50 units has only the hall.
    all.push(line('ROW 33', '03-K', 50, []));
    const stock = zoneStock(ZONES.bay3_north, model, all);
    const d = distribute(stock, model, plannedState(stock, []));
    const hall = d.drafts.find((m) => m.toLocation === OVERFLOW_LOCATION)!;
    expect(hall).toMatchObject({ sku: '03-K', qty: 50, kind: 'move', toLetters: [] });
    expect(d.toHall).toBe(1);
  });

  it('gives a line with no letter a square in its own row, and leaves a line in K alone', () => {
    // 33-K is a drawn square since 31 Aug 2026: a line living there already
    // fits, so DISTRIBUTE has nothing to do with it.
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
        origin: 'auto' as const,
        status: 'planned',
        error: null,
      },
    ]);
    expect(distribute(stock, model, state).drafts).toEqual([]);
  });
});

describe("repairOverCap — the plan's own landings (31 Aug 2026)", () => {
  // Rafael: "todavía tengo algunos con 69 y 90 unidades". A hand drop carries
  // the square's whole pallet, so a move of 240 landed 240 in one square.
  const asMove = (over: Partial<PlanMove> = {}): PlanMove => ({
    id: 7,
    planId: 'p',
    position: 1,
    inventoryId: 1,
    sku: '03-3978BL',
    qty: 240,
    itemName: null,
    warehouse: 'LUDLOW',
    fromLocation: 'ROW 30',
    fromSublocation: ['H'],
    toLocation: 'ROW 32',
    toLetters: ['H'],
    kind: 'move',
    origin: 'auto' as const,
    status: 'planned',
    error: null,
    ...over,
  });

  it('spreads a landing over the squares it needs, its own row first', () => {
    const rows = [line('ROW 30', '03-3978BL', 240, ['H'])];
    const stock = zoneStock(ZONES.bay3_north, model, rows);
    const move = asMove();
    const r = repairOverCap(model, plannedState(stock, [move]), [move]);
    expect(r.removals).toEqual([move.id]);
    const first = r.drafts[0];
    expect(first.toLocation).toBe('ROW 32');
    expect(first.toLetters).toHaveLength(8); // 240 at 30 a square
    expect(first.toLetters).toContain('H');
    expect(first.qty).toBe(240);
    expect(r.drafts).toHaveLength(1);
  });

  it('leaves a landing that already fits alone', () => {
    const rows = [line('ROW 30', '03-3978BL', 60, ['H'])];
    const stock = zoneStock(ZONES.bay3_north, model, rows);
    const move = asMove({ qty: 60, toLetters: ['H', 'I'] });
    expect(repairOverCap(model, plannedState(stock, [move]), [move]).drafts).toEqual([]);
  });

  it('spills to the nearest rows and then the MAIN HALL when its row is full', () => {
    // Every square taken but four in ROW 32: a 400-unit landing needs 14.
    const rows = model.validCells
      .filter((c) => !(String(c.row.num) === '32' && ['H', 'I', 'J', 'K'].includes(c.letter)))
      .map((c, i) => line(`ROW ${c.row.num}`, `FILL-${i}`, 30, [c.letter]));
    rows.push(line('ROW 30', '03-BIG', 400, ['A']));
    const stock = zoneStock(ZONES.bay3_north, model, rows);
    const move = asMove({ inventoryId: rows[rows.length - 1].id, qty: 400, toLetters: ['H'] });
    const r = repairOverCap(model, plannedState(stock, [move]), [move]);
    const hall = r.drafts.find((d) => d.toLocation === OVERFLOW_LOCATION)!;
    expect(hall.qty).toBe(400 - 4 * 30);
    expect(r.drafts.filter((d) => d.toLocation === 'ROW 32')[0].toLetters).toEqual([
      'H',
      'I',
      'J',
      'K',
    ]);
  });
});

describe('the space comes first — MAS is the last resort (31 Aug 2026)', () => {
  // Rafael: "aún hay espacio, y el algoritmo debería priorizar llenar el
  // espacio primero, y cuando no haya espacio el extra va en MAS".
  const parked = (id: number, qty: number): PlanMove => ({
    id,
    planId: 'p',
    position: id,
    inventoryId: id,
    sku: `03-000${id}`,
    qty,
    itemName: null,
    warehouse: 'LUDLOW',
    fromLocation: 'ROW 32',
    fromSublocation: null,
    toLocation: OVERFLOW_LOCATION,
    toLetters: [],
    kind: 'move',
    origin: 'auto' as const,
    status: 'planned',
    error: null,
  });

  it('brings units parked in MAS back into free squares, small lines sharing one', () => {
    const stock = zoneStock(ZONES.bay3_north, model, []);
    const moves = [1, 2, 3, 4].map((i) => parked(i, 1));
    const r = repairOverCap(model, plannedState(stock, moves), moves);
    expect(r.removals.sort()).toEqual([1, 2, 3, 4]);
    expect(r.drafts).toHaveLength(4);
    // One square for the four of them, in their own row.
    expect(new Set(r.drafts.map((d) => `${d.toLocation} ${d.toLetters.join()}`)).size).toBe(1);
    expect(r.drafts[0].toLocation).toBe('ROW 32');
    expect(r.drafts.every((d) => d.kind === 'relabel')).toBe(true);
  });

  it('leaves in MAS only what no square can take', () => {
    // Every square full but one: 60 units come back 30, and 30 stay in MAS.
    const rows = model.validCells
      .filter((c) => !(String(c.row.num) === '32' && c.letter === 'K'))
      .map((c, i) => line(`ROW ${c.row.num}`, `FILL-${i}`, 30, [c.letter]));
    const stock = zoneStock(ZONES.bay3_north, model, rows);
    const moves = [parked(99, 60)];
    const r = repairOverCap(model, plannedState(stock, moves), moves);
    expect(r.removals).toEqual([99]);
    expect(r.drafts.map((d) => [d.toLocation, d.qty])).toEqual([
      ['ROW 32', 30],
      [OVERFLOW_LOCATION, 30],
    ]);
  });

  it('leaves it alone when there is no square at all', () => {
    const rows = model.validCells.map((c, i) =>
      line(`ROW ${c.row.num}`, `FILL-${i}`, 30, [c.letter])
    );
    const stock = zoneStock(ZONES.bay3_north, model, rows);
    const moves = [parked(99, 5)];
    expect(repairOverCap(model, plannedState(stock, moves), moves).drafts).toEqual([]);
  });
});

describe('a square shared by two lines (31 Aug 2026)', () => {
  // Rafael: "aún tenemos ese 69… cuando todavía quedan espacios vacíos".
  // On his own plan two squares were over the cap for two different reasons:
  // one line reading 69 because allocate dumped the remainder in the last
  // square, and 31-C = 30 + 30, where nobody is too big alone.
  it('sends the smallest one to a free square, and nobody is over the cap', () => {
    const rows = [line('ROW 31', '03-3983GY', 30, ['C']), line('ROW 30', '03-3982BL', 30, ['A'])];
    const stock = zoneStock(ZONES.bay3_north, model, rows);
    const landing: PlanMove = {
      id: 5,
      planId: 'p',
      position: 1,
      inventoryId: rows[1].id,
      sku: '03-3982BL',
      qty: 30,
      itemName: null,
      warehouse: 'LUDLOW',
      fromLocation: 'ROW 30',
      fromSublocation: ['A'],
      toLocation: 'ROW 31',
      toLetters: ['C'],
      kind: 'move',
      origin: 'auto' as const,
      status: 'planned',
      error: null,
    };
    const before = plannedState(stock, [landing]);
    expect(before.unitsAt('31-C')).toBe(60);

    const r = repairOverCap(model, before, [landing]);
    expect(r.drafts).toHaveLength(1);
    const moves = [
      ...[landing].filter((m) => !r.removals.includes(m.id)),
      ...r.drafts.map((d, i) => ({
        ...d,
        id: 90 + i,
        planId: 'p',
        position: 9,
        status: 'planned' as const,
        error: null,
      })),
    ];
    const after = plannedState(stock, moves);
    expect(after.unitsAt('31-C')).toBeLessThanOrEqual(45);
    // Nothing anywhere is over the cap, and nothing was sent to MAS.
    for (const c of model.validCells) expect(after.unitsAt(slotKey(c))).toBeLessThanOrEqual(45);
    expect(moves.every((m) => m.toLetters.length > 0)).toBe(true);
  });

  it('a line spread over its squares reads evenly — no invented square over the cap', () => {
    const rows = [line('ROW 33', '03-4038BL', 159, ['G', 'H', 'I', 'J'])];
    const stock = zoneStock(ZONES.bay3_north, model, rows);
    expect([...'GHIJ'].map((l) => stock.cells.get(`33-${l}`)!.units)).toEqual([40, 40, 40, 39]);
    expect(repairOverCap(model, plannedState(stock, []), []).drafts).toEqual([]);
  });
});

describe('a hand move is fixed (31 Aug 2026)', () => {
  // Rafael: "quiero que los movimientos que se hacen a un sku queden fijos a
  // menos que yo lo vuelva a mover". Siebel's Lock Assignment, Tetris's lock
  // delay: the optimizer plans AROUND it, the person is the only one who
  // changes it.
  const move = (over: Partial<PlanMove>): PlanMove => ({
    id: 1,
    planId: 'p',
    position: 1,
    inventoryId: 1,
    sku: '03-3978BL',
    qty: 240,
    itemName: null,
    warehouse: 'LUDLOW',
    fromLocation: 'ROW 30',
    fromSublocation: ['H'],
    toLocation: 'ROW 32',
    toLetters: ['H'],
    kind: 'move',
    origin: 'hand',
    status: 'planned',
    error: null,
    ...over,
  });

  it('no pass rewrites it, however badly it lands', () => {
    const rows = [line('ROW 30', '03-3978BL', 240, ['H'])];
    const stock = zoneStock(ZONES.bay3_north, model, rows);
    const hand = move({});
    const r = repairOverCap(model, plannedState(stock, [hand]), [hand]);
    expect(r.removals).toEqual([]);
    expect(r.drafts).toEqual([]);
    // The same landing made by the plan itself IS re-planned.
    const auto = move({ origin: 'auto' });
    expect(repairOverCap(model, plannedState(stock, [auto]), [auto]).removals).toEqual([auto.id]);
  });

  it('a hand move parked in MAS stays there; the plan only brings back its own', () => {
    const stock = zoneStock(ZONES.bay3_north, model, []);
    const parked = move({ qty: 5, toLocation: OVERFLOW_LOCATION, toLetters: [] });
    expect(repairOverCap(model, plannedState(stock, [parked]), [parked]).drafts).toEqual([]);
    const auto = { ...parked, origin: 'auto' as const };
    expect(repairOverCap(model, plannedState(stock, [auto]), [auto]).drafts).toHaveLength(1);
  });

  it('the drop itself fans a big pallet out, so it is settled before it locks', () => {
    const rows = [line('ROW 30', '03-3978BL', 240, ['H'])];
    const stock = zoneStock(ZONES.bay3_north, model, rows);
    const state = plannedState(stock, []);
    const dropped = spreadDrop(model, state, [
      {
        origin: 'hand',
        inventoryId: rows[0].id,
        sku: '03-3978BL',
        qty: 240,
        itemName: null,
        warehouse: 'LUDLOW',
        fromLocation: 'ROW 30',
        fromSublocation: ['H'],
        toLocation: 'ROW 32',
        toLetters: ['H'],
        kind: 'move',
      },
    ]);
    // One gesture, one move — over the eight squares 240 units need.
    expect(dropped).toHaveLength(1);
    expect(dropped[0].toLetters).toHaveLength(8);
    expect(dropped.every((d) => d.origin === 'hand')).toBe(true);
    expect(dropped[0].toLetters).toContain('H'); // the square he pointed at
    expect(dropped[0].toLocation).toBe('ROW 32'); // the row he pointed at
    expect(dropped.reduce((s, d) => s + d.qty, 0)).toBe(240);
    // And nothing lands over the cap.
    const after = plannedState(
      stock,
      dropped.map((d, i) => ({
        ...d,
        id: 50 + i,
        planId: 'p',
        position: i,
        status: 'planned' as const,
        error: null,
      }))
    );
    for (const c of model.validCells) expect(after.unitsAt(slotKey(c))).toBeLessThanOrEqual(45);
  });
});
