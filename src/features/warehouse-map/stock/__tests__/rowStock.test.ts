// PRD warehouse-map-measured, V6–V8: the map says what the DB says, slot by
// slot, and lists out loud what it has no place for.

import { describe, it, expect } from 'vitest';
import {
  parseRowLocation,
  zoneOwnsRow,
  zoneRows,
  zoneStock,
  outsideAnyPlan,
  describeCell,
  groupUnplaced,
  allocate,
  squaresFor,
  type StockRow,
} from '../rowStock';
import { ZONES, ZONE_IDS, calculateLayout, defaultEngineState } from '../../engine';

let nextId = 1;
const line = (
  location: string,
  sku: string,
  quantity: number,
  sublocation: string[] | null = ['A']
): StockRow => ({
  id: nextId++,
  sku,
  itemName: null,
  location,
  warehouse: 'LUDLOW',
  sublocation,
  quantity,
});

const bay3North = calculateLayout(ZONES.bay3_north, defaultEngineState())!;

describe('parseRowLocation', () => {
  it('reads the number and whatever follows it', () => {
    expect(parseRowLocation('ROW 33')).toEqual({ number: 33, suffix: '' });
    expect(parseRowLocation(' row 20b ')).toEqual({ number: 20, suffix: 'B' });
    expect(parseRowLocation('ROW 42 BURIED')).toEqual({ number: 42, suffix: 'BURIED' });
    expect(parseRowLocation('ROW X EP')).toEqual({ number: null, suffix: 'X EP' });
  });

  it('is null for anything that is not a row', () => {
    expect(parseRowLocation('D2')).toBeNull();
    expect(parseRowLocation('FDX STATION')).toBeNull();
    expect(parseRowLocation('ATS-ROW 1')).toBeNull();
    expect(parseRowLocation('ROW')).toBeNull();
    expect(parseRowLocation(null)).toBeNull();
  });
});

describe('which zone answers for a row', () => {
  it('follows the zone row ranges, both ends inclusive', () => {
    expect(zoneOwnsRow(ZONES.bay3_north, 18)).toBe(true);
    expect(zoneOwnsRow(ZONES.bay3_north, 33)).toBe(true);
    expect(zoneOwnsRow(ZONES.bay3_north, 34)).toBe(false);
    expect(zoneOwnsRow(ZONES.bay3_se, 37)).toBe(true);
    expect(zoneOwnsRow(ZONES.bay2_north, 1)).toBe(true);
    expect(zoneOwnsRow(ZONES.bay2_north, 10)).toBe(true);
    expect(zoneOwnsRow(ZONES.bay2_south, 15)).toBe(true);
    expect(zoneOwnsRow(ZONES.bay1_north, 51)).toBe(true);
  });

  it('the office gap answers for nothing: its labels reuse Bay 1 North numbers', () => {
    expect(zoneOwnsRow(ZONES.bay1_office_gap, 43)).toBe(false);
  });

  it('every DB row with stock today has exactly one zone', () => {
    const today = [
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 15, 16, 17, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 32, 33,
      34, 37, 38, 41, 42, 43, 51,
    ];
    for (const n of today) {
      const owners = ZONE_IDS.filter((id) => zoneOwnsRow(ZONES[id], n));
      expect(owners, `ROW ${n}`).toHaveLength(1);
    }
  });
});

describe('V6 — ROW 33: 845 u in A, B, D, E and K', () => {
  const rows = [
    line('ROW 33', '03-4085BK', 400, ['A']),
    line('ROW 33', '03-3931BK', 200, ['B']),
    line('ROW 33', '03-4066BK', 120, ['D']),
    line('ROW 33', '03-4046MN', 100, ['E']),
    line('ROW 33', '03-3768BL', 25, ['K']),
  ];
  const stock = zoneStock(ZONES.bay3_north, bay3North, rows);

  it('paints A, B, D and E in row 33 of Bay 3 North', () => {
    expect([...stock.cells.keys()].sort()).toEqual(['33-A', '33-B', '33-D', '33-E']);
    expect(stock.cells.get('33-A')!.entries[0]).toMatchObject({ sku: '03-4085BK', qty: 400 });
  });

  it('lists K as having no slot on the plan — the row is ten deep, A to J', () => {
    expect(stock.unplaced).toHaveLength(1);
    expect(stock.unplaced[0]).toMatchObject({ reason: 'letter', letters: ['K'] });
    expect(stock.unplaced[0].row.sku).toBe('03-3768BL');
  });

  it('counts all 845 units and one row', () => {
    expect(stock.units).toBe(845);
    expect(stock.lines).toBe(5);
    expect(stock.rows).toBe(1);
  });
});

describe('V7 — ROW 10: two lines in D, sixteen with no letter', () => {
  const rows = [
    line('ROW 10', '01-0288', 40, ['D']),
    line('ROW 10', '01-0290', 30, ['D']),
    ...Array.from({ length: 16 }, (_, i) => line('ROW 10', `01-05${10 + i}`, 1, null)),
  ];
  const model = calculateLayout(ZONES.bay2_north, defaultEngineState())!;
  const stock = zoneStock(ZONES.bay2_north, model, rows);

  it('fills 10-D with both lines and lists the sixteen beside the row', () => {
    expect([...stock.cells.keys()]).toEqual(['10-D']);
    expect(stock.cells.get('10-D')!.units).toBe(70);
    expect(stock.cells.get('10-D')!.entries.map((e) => e.sku)).toEqual(['01-0288', '01-0290']);
    expect(stock.unplaced.filter((u) => u.reason === 'no-letter')).toHaveLength(16);
    expect(stock.units).toBe(86);
  });
});

describe('V8 — ROW 43 lands in Bay 1 North', () => {
  it('paints its five letters', () => {
    const rows = ['A', 'B', 'D', 'E', 'F'].map((l) => line('ROW 43', `03-46${l}`, 200, [l]));
    const model = calculateLayout(ZONES.bay1_north, defaultEngineState())!;
    const stock = zoneStock(ZONES.bay1_north, model, rows);
    expect([...stock.cells.keys()].sort()).toEqual(['43-A', '43-B', '43-D', '43-E', '43-F']);
    expect(stock.unplaced).toHaveLength(0);
  });
});

describe('what the drawing has no place for', () => {
  it('ROW 20B and ROW 42 BURIED sit beside their rows, not in a slot', () => {
    const s3 = zoneStock(ZONES.bay3_north, bay3North, [line('ROW 20B', '03-3931BK', 27, ['A'])]);
    expect(s3.cells.size).toBe(0);
    expect(s3.unplaced[0]).toMatchObject({ reason: 'suffix', parsed: { number: 20, suffix: 'B' } });

    const b1 = calculateLayout(ZONES.bay1_north, defaultEngineState())!;
    const s1 = zoneStock(ZONES.bay1_north, b1, [line('ROW 42 BURIED', '03-3931BK', 33, null)]);
    expect(s1.unplaced[0]).toMatchObject({
      reason: 'suffix',
      parsed: { number: 42, suffix: 'BURIED' },
    });
    expect(s1.units).toBe(33);
  });

  it('ROW X EP belongs to no plan at all', () => {
    const rows = [
      line('ROW X EP', '03-4085BK', 41, null),
      line('ROW 33', '03-4085BK', 400, ['A']),
      line('D2', '31-0075', 500, null),
    ];
    const configs = ZONE_IDS.map((id) => ZONES[id]);
    expect(outsideAnyPlan(configs, rows).map((r) => r.location)).toEqual(['ROW X EP']);
    expect(zoneRows(ZONES.bay3_north, rows).map((r) => r.location)).toEqual(['ROW 33']);
  });

  it('a row the layout does not draw is listed, not lost', () => {
    // Rows 18 and 19 only exist once the west strip is reclaimed.
    const rows = [line('ROW 18', '03-4085BK', 30, ['A'])];
    expect(zoneStock(ZONES.bay3_north, bay3North, rows).unplaced[0].reason).toBe('row');
    const freed = calculateLayout(
      ZONES.bay3_north,
      defaultEngineState({ toggles: { west: false } })
    )!;
    expect(zoneStock(ZONES.bay3_north, freed, rows).cells.has('18-A')).toBe(true);
  });

  it('when nothing fits, every line is unplaced', () => {
    const rows = [line('ROW 33', '03-4085BK', 400, ['A'])];
    const stock = zoneStock(ZONES.bay3_north, null, rows);
    expect(stock.cells.size).toBe(0);
    expect(stock.unplaced[0].reason).toBe('row');
  });
});

describe('a line across two letters', () => {
  const rows = [line('ROW 33', '03-4085BK', 60, ['A', 'B'])];
  const stock = zoneStock(ZONES.bay3_north, bay3North, rows);

  it('is drawn in both squares, a pallet in each, and counted once', () => {
    expect(stock.cells.get('33-A')!.entries[0]).toMatchObject({ span: 2, qty: 60, qtyHere: 30 });
    expect(stock.cells.get('33-B')!.entries[0]).toMatchObject({ span: 2, qty: 60, qtyHere: 30 });
    expect(stock.cells.get('33-A')!.units).toBe(30);
    expect(stock.units).toBe(60);
    expect(describeCell(stock.cells.get('33-A')!)).toBe(
      'ROW 33 · A · 03-4085BK 30 of 60u (2 squares)'
    );
  });

  it('a line with too few squares shows the overflow in its last square, over capacity', () => {
    const big = zoneStock(ZONES.bay3_north, bay3North, [line('ROW 33', '03-3983GY', 230, ['C'])]);
    const cell = big.cells.get('33-C')!;
    expect(cell.units).toBe(230);
    expect(describeCell(cell)).toContain('OVER CAPACITY');
    expect(allocate(132, 5)).toEqual([30, 30, 30, 30, 12]);
    expect(squaresFor(132)).toBe(5);
    expect(squaresFor(30)).toBe(1);
    expect(squaresFor(0)).toBe(1);
  });
});

describe('groupUnplaced', () => {
  it('folds the lines of one row and one reason into one group, in order', () => {
    const rows = [
      line('ROW 20B', '06-4652BK', 16, ['A']),
      ...Array.from({ length: 36 }, (_, i) => line('ROW 33', `01-04${10 + i}`, 1, null)),
      line('ROW 33', '03-3768BL', 25, ['K']),
    ];
    const groups = groupUnplaced(zoneStock(ZONES.bay3_north, bay3North, rows).unplaced);
    expect(groups.map((g) => [g.location, g.reason, g.items.length, g.units])).toEqual([
      ['ROW 20B', 'suffix', 1, 16],
      ['ROW 33', 'letter', 1, 25],
      ['ROW 33', 'no-letter', 36, 36],
    ]);
  });
});
