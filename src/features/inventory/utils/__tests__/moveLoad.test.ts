import { describe, expect, it } from 'vitest';
import {
  allocate,
  landInRow,
  parseDestination,
  rowOccupancy,
  rowStock,
  stockUnits,
  takeCount,
  takePallets,
  toDistribution,
} from '../moveLoad';

// The verification cases of docs/prds/relocate-stock-redesign.md §9 (prod, 7 Oct 2026).

describe('rowStock', () => {
  it('one letter holds everything, loose included (03-3740BK · ROW 1 · E)', () => {
    const rs = rowStock({
      quantity: 35,
      location: 'ROW 1',
      sublocation: ['E'],
      distribution: [
        { type: 'TOWER', count: 1, units_each: 30 },
        { type: 'LINE', count: 1, units_each: 3 },
      ],
    });
    expect(rs.needsSplit).toBeNull();
    expect(rs.squares).toHaveLength(1);
    expect(rs.squares[0].square).toBe('E');
    expect(rs.squares[0].loose).toBe(2);
    expect(stockUnits(rs.squares[0])).toBe(35);
  });

  it('several letters without squares ask for the split, then fill each (03-3983GY · ROW 33)', () => {
    const row = {
      quantity: 58,
      location: 'ROW 33',
      sublocation: ['B', 'C'],
      distribution: [
        { type: 'LINE' as const, count: 5, units_each: 5 },
        { type: 'LINE' as const, count: 1, units_each: 3 },
      ],
    };
    expect(rowStock(row).needsSplit).toEqual(['B', 'C']);
    const rs = rowStock(row, { B: 28, C: 30 });
    expect(rs.needsSplit).toBeNull();
    const [b, c] = rs.squares;
    expect(b.groups).toEqual([
      { type: 'LINE', count: 5, units_each: 5, square: 'B' },
      { type: 'LINE', count: 1, units_each: 3, square: 'B' },
    ]);
    expect(b.loose).toBe(0);
    expect(c.groups).toEqual([]);
    expect(c.loose).toBe(30);
  });

  it('outside a ROW there are no squares', () => {
    const rs = rowStock({
      quantity: 13700,
      location: 'D7',
      sublocation: null,
      distribution: [],
    });
    expect(rs.squares).toEqual([{ square: null, groups: [], loose: 13700 }]);
  });
});

describe('the load', () => {
  const e = rowStock({
    quantity: 35,
    location: 'ROW 1',
    sublocation: ['E'],
    distribution: [
      { type: 'TOWER', count: 1, units_each: 30 },
      { type: 'LINE', count: 1, units_each: 3 },
    ],
  }).squares[0];

  it('a tapped tower lifts whole', () => {
    const tower = e.groups.findIndex((g) => g.type === 'TOWER');
    const { load, after } = takePallets(e, new Set([tower]));
    expect(load.units).toBe(30);
    expect(stockUnits(after)).toBe(5);
  });

  it('a typed number leaves in pick order, loose last (03-4666BR · ROW 1 · B, 11)', () => {
    const b = rowStock({
      quantity: 41,
      location: 'ROW 1',
      sublocation: ['B'],
      distribution: [
        { type: 'LINE', count: 4, units_each: 5 },
        { type: 'LINE', count: 1, units_each: 2 },
      ],
    }).squares[0];
    const { load, after } = takeCount(b, 11);
    expect(load.units).toBe(11);
    expect(load.loose).toBe(0);
    expect(after.groups).toEqual([
      { type: 'LINE', count: 2, units_each: 5, square: 'B' },
      { type: 'LINE', count: 1, units_each: 1, square: 'B' },
    ]);
    expect(after.loose).toBe(19);
  });

  it('a number off a DS comes from the top first 🪜', () => {
    const g = rowStock({
      quantity: 30,
      location: 'ROW 31',
      sublocation: ['G'],
      distribution: [
        { type: 'BASE', count: 1, units_each: 18 },
        { type: 'TOP', count: 1, units_each: 12 },
      ],
    }).squares[0];
    const { load, after } = takeCount(g, 5);
    expect(load.fromTop).toBe(5);
    expect([load.topBefore, load.topAfter]).toEqual([12, 7]);
    expect(after.groups).toContainEqual({ type: 'TOP', count: 1, units_each: 7, square: 'G' });
  });
});

describe('where it lands', () => {
  it('each tapped square fills to 30 (03-3980BL · 82 → ROW 20 · B C E)', () => {
    const { land, left } = allocate(82, ['B', 'C', 'E'], new Map());
    expect(land).toEqual([
      { square: 'B', units: 30 },
      { square: 'C', units: 30 },
      { square: 'E', units: 22 },
    ]);
    expect(left).toBe(0);
  });

  it('what no square has room for stays in the last, flagged (06-4588BL · 36 → K)', () => {
    const { land, left } = allocate(36, ['K'], new Map());
    expect(land).toEqual([{ square: 'K', units: 36 }]);
    expect(left).toBe(6);
  });

  it('a square with the same SKU is rebuilt with the DS rule: 9 + 4 = base 13 (03-4466BR)', () => {
    const dest = rowStock({
      quantity: 9,
      location: 'ROW 25',
      sublocation: ['C'],
      distribution: [{ type: 'LINE', count: 1, units_each: 4 }],
    });
    const src = rowStock({
      quantity: 4,
      location: 'ROW 3',
      sublocation: ['C'],
      distribution: [{ type: 'LINE', count: 1, units_each: 4 }],
    }).squares[0];
    const { load } = takePallets(src, new Set([0]));
    const out = landInRow(dest, [], load, [{ square: 'C', units: 4 }], false);
    expect(out).toEqual([{ type: 'BASE', count: 1, units_each: 13, square: 'C' }]);
  });

  it('82 over three squares become DS, DS and base 18 + top 4', () => {
    const src = rowStock({
      quantity: 82,
      location: 'ROW 34',
      sublocation: ['F'],
      distribution: [
        { type: 'TOWER', count: 2, units_each: 30 },
        { type: 'TOWER', count: 1, units_each: 16 },
      ],
    }).squares[0];
    const { load } = takeCount(src, 82);
    const { land } = allocate(82, ['B', 'C', 'E'], new Map());
    const out = landInRow(null, [], load, land, false);
    expect(out).toEqual([
      { type: 'BASE', count: 1, units_each: 18, square: 'B' },
      { type: 'TOP', count: 1, units_each: 12, square: 'B' },
      { type: 'BASE', count: 1, units_each: 18, square: 'C' },
      { type: 'TOP', count: 1, units_each: 12, square: 'C' },
      { type: 'BASE', count: 1, units_each: 18, square: 'E' },
      { type: 'TOP', count: 1, units_each: 4, square: 'E' },
    ]);
  });

  it('a kids bike is never rebuilt: a tower lands as it is', () => {
    const src = rowStock({
      quantity: 158,
      location: 'ROW 42',
      sublocation: ['K'],
      distribution: [
        { type: 'TOWER', count: 1, units_each: 28 },
        { type: 'TOWER', count: 4, units_each: 30 },
      ],
    }).squares[0];
    const i = src.groups.findIndex((g) => g.units_each === 30);
    const { load } = takePallets(src, new Set([i]));
    expect(landInRow(null, [], load, [{ square: 'F', units: 120 }], true)).toEqual([
      { type: 'TOWER', count: 4, units_each: 30, square: 'F' },
    ]);
  });

  it('another square of the same row: the line goes E → F', () => {
    const rs = rowStock({
      quantity: 35,
      location: 'ROW 1',
      sublocation: ['E'],
      distribution: [
        { type: 'TOWER', count: 1, units_each: 30 },
        { type: 'LINE', count: 1, units_each: 3 },
      ],
    });
    const e = rs.squares[0];
    const line = e.groups.findIndex((g) => g.type === 'LINE');
    const { load, after } = takePallets(e, new Set([line]));
    const origin = { squares: [after], needsSplit: null };
    const out = landInRow(origin, [], load, [{ square: 'F', units: 3 }], false);
    expect(out).toEqual([
      { type: 'TOWER', count: 1, units_each: 30, square: 'E' },
      { type: 'LINE_PALLET', count: 1, units_each: 3, square: 'F' },
    ]);
    expect(toDistribution([after])).toEqual([
      { type: 'TOWER', count: 1, units_each: 30, square: 'E' },
    ]);
  });

  it('a destination waiting for its split keeps its groups unsquared', () => {
    const dest = rowStock({
      quantity: 20,
      location: 'ROW 30',
      sublocation: ['C', 'D'],
      distribution: [{ type: 'LINE', count: 4, units_each: 5 }],
    });
    const raw = [{ type: 'LINE' as const, count: 4, units_each: 5 }];
    const load = {
      square: 'A',
      groups: [{ type: 'LINE' as const, count: 1, units_each: 1 }],
      loose: 0,
      units: 1,
      fromTop: 0,
      topBefore: 0,
      topAfter: 0,
    };
    const out = landInRow(dest, raw, load, [{ square: 'H', units: 1 }], false);
    expect(out).toContainEqual({ type: 'LINE', count: 4, units_each: 5 });
    expect(out).toContainEqual({ type: 'LINE_PALLET', count: 1, units_each: 1, square: 'H' });
  });
});

describe('rowOccupancy', () => {
  it('counts every SKU per square; an unsplit line is spread evenly', () => {
    const occ = rowOccupancy(
      [
        {
          sku: 'A',
          quantity: 9,
          location: 'ROW 25',
          sublocation: ['C'],
          distribution: [{ type: 'LINE', count: 1, units_each: 4 }],
        },
        {
          sku: 'B',
          quantity: 20,
          location: 'ROW 25',
          sublocation: ['C', 'D'],
          distribution: [{ type: 'LINE', count: 4, units_each: 5 }],
        },
      ],
      'A'
    );
    expect(occ.get('C')).toEqual({ units: 19, mine: 9, others: 1 });
    expect(occ.get('D')).toEqual({ units: 10, mine: 0, others: 1 });
  });
});

describe('parseDestination', () => {
  it.each([
    ['30', 'ROW 30', null],
    ['ROW 30', 'ROW 30', null],
    ['r30', 'ROW 30', null],
    ['30F', 'ROW 30', 'F'],
    ['30 f', 'ROW 30', 'F'],
    ['ROW 30-F', 'ROW 30', 'F'],
    ['cage', 'CAGE', null],
    ['e21', 'E21', null],
  ])('%s → %s %s', (text, location, square) => {
    expect(parseDestination(text)).toEqual({ location, square });
  });
});
