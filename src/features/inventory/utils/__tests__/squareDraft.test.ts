import { describe, expect, it } from 'vitest';
import {
  acceptRule,
  acceptSplit,
  draftChanges,
  draftQuantity,
  draftToSave,
  looseOf,
  movePallet,
  moveSquare,
  overflowTo,
  proposalFor,
  proposeSplit,
  rebaseDraft,
  rowDraft,
  setPalletType,
  setSquareUnits,
  deletePallet,
} from '../squareEdit';

// The verification cases of docs/prds/square-edit-mode.md §9 (prod, 7 Oct 2026).
const row = (
  quantity: number,
  location: string,
  sublocation: string[] | null,
  distribution: {
    type: 'BASE' | 'TOP' | 'LINE_PALLET' | 'TOWER' | 'LINE';
    count: number;
    units_each: number;
    square?: string;
  }[] = []
) => ({ quantity, location, sublocation, distribution });

const sq = (d: ReturnType<typeof rowDraft>, l: string | null) =>
  d.squares.find((s) => s.letter === l)!;

describe('one tap: the rule proposes, ✓ accepts', () => {
  it('1 · a loose square of 29 → base 18 + top 11 (03-3743GN ROW 29 · F)', () => {
    const base = rowDraft(row(29, 'ROW 29', ['F']));
    expect(sq(base, 'F').units).toBe(29);
    expect(proposalFor(sq(base, 'F'), false)).toEqual({
      kind: 'rule',
      pallets: [
        { type: 'BASE', count: 1, units_each: 18, square: 'F' },
        { type: 'TOP', count: 1, units_each: 11, square: 'F' },
      ],
    });
    const cur = acceptRule(base, 'F');
    expect(proposalFor(sq(cur, 'F'), false)).toBeNull();
    expect(draftChanges(base, cur)).toHaveLength(1);
    expect(draftToSave(cur)).toEqual({
      quantity: 29,
      distribution: [
        { type: 'BASE', count: 1, units_each: 18, square: 'F' },
        { type: 'TOP', count: 1, units_each: 11, square: 'F' },
      ],
      sublocation: ['F'],
    });
  });

  it('3 · boxes short of the figure: the whole square is rebuilt, base 14 (06-4453BL)', () => {
    const base = rowDraft(
      row(
        14,
        'ROW 2',
        ['G'],
        [
          { type: 'LINE', count: 1, units_each: 2 },
          { type: 'LINE', count: 2, units_each: 5 },
        ]
      )
    );
    expect(looseOf(sq(base, 'G'))).toBe(2);
    expect(proposalFor(sq(base, 'G'), false)).toEqual({
      kind: 'rule',
      pallets: [{ type: 'BASE', count: 1, units_each: 14, square: 'G' }],
    });
  });

  it('7 · already by the rule: nothing to offer', () => {
    const base = rowDraft(
      row(
        45,
        'ROW 30',
        ['C', 'D'],
        [
          { type: 'BASE', count: 1, units_each: 18, square: 'C' },
          { type: 'TOP', count: 1, units_each: 12, square: 'C' },
          { type: 'BASE', count: 1, units_each: 15, square: 'D' },
        ]
      )
    );
    expect(base.squares.map((s) => proposalFor(s, false))).toEqual([null, null]);
  });

  it('a single loose unit draws nothing and asks nothing', () => {
    expect(proposalFor(sq(rowDraft(row(1, 'ROW 3', ['A'])), 'A'), false)).toBeNull();
  });
});

describe('the split of a ? row', () => {
  it('30 per square A→Z, the rest in the last', () => {
    expect(proposeSplit(['B', 'C'], 58)).toEqual({ B: 30, C: 28 });
    expect(proposeSplit(['A', 'B', 'C'], 40)).toEqual({ A: 30, B: 10, C: 0 });
  });

  it('4 · B 30 · C 28, each built by the rule (03-3983GY ROW 33)', () => {
    const r = row(
      58,
      'ROW 33',
      ['B', 'C'],
      [
        { type: 'LINE', count: 5, units_each: 5 },
        { type: 'LINE', count: 1, units_each: 3 },
      ]
    );
    const base = rowDraft(r);
    expect(base.needsSplit).toEqual(['B', 'C']);
    const cur = acceptSplit(r, proposeSplit(base.needsSplit!, r.quantity), false);
    expect(draftToSave(cur)).toEqual({
      quantity: 58,
      distribution: [
        { type: 'BASE', count: 1, units_each: 18, square: 'B' },
        { type: 'TOP', count: 1, units_each: 12, square: 'B' },
        { type: 'BASE', count: 1, units_each: 18, square: 'C' },
        { type: 'TOP', count: 1, units_each: 10, square: 'C' },
      ],
      sublocation: ['B', 'C'],
    });
    expect(draftChanges(base, cur).map((c) => [c.square, c.after])).toEqual([
      ['B', 30],
      ['C', 28],
    ]);
  });

  it('5 · boxes beyond the quantity: the figures come from the quantity (03-3982BL, 54 of 115)', () => {
    const r = row(
      54,
      'ROW 30',
      ['F', 'G'],
      [
        { type: 'TOWER', count: 3, units_each: 30, square: 'F' },
        { type: 'LINE', count: 5, units_each: 5, square: 'G' },
      ]
    );
    const base = rowDraft(r);
    expect(base.needsSplit).toEqual(['F', 'G']);
    const cur = acceptSplit(r, proposeSplit(['F', 'G'], 54), false);
    expect(cur.squares.map((s) => [s.letter, s.units, proposalFor(s, false)])).toEqual([
      ['F', 30, null],
      ['G', 24, null],
    ]);
    expect(draftQuantity(cur)).toBe(54);
  });
});

describe('a figure typed', () => {
  it('9 · a count: 17 → 16 rebuilds as base 16 and the quantity follows', () => {
    const base = rowDraft(row(17, 'ROW 14', ['F'], [{ type: 'LINE', count: 3, units_each: 5 }]));
    const cur = setSquareUnits(base, 'F', 16, false);
    expect(sq(cur, 'F').pallets).toEqual([{ type: 'BASE', count: 1, units_each: 16, square: 'F' }]);
    expect(draftToSave(cur).quantity).toBe(16);
  });

  it('a kids square keeps its pallets; the difference is loose', () => {
    const base = rowDraft(
      row(
        158,
        'ROW 42',
        ['K'],
        [
          { type: 'TOWER', count: 1, units_each: 28 },
          { type: 'TOWER', count: 4, units_each: 30 },
        ]
      )
    );
    expect(proposalFor(sq(base, 'K'), true)).toBeNull();
    expect(looseOf(sq(base, 'K'))).toBe(10);
    const cur = setSquareUnits(base, 'K', 150, true);
    expect(sq(cur, 'K').pallets).toEqual(sq(base, 'K').pallets);
    expect(looseOf(sq(cur, 'K'))).toBe(2);
  });

  it('11 · a part: one figure, no squares', () => {
    const base = rowDraft(row(13700, 'D7', null));
    expect(base.squares).toEqual([{ letter: null, units: 13700, pallets: [] }]);
    const cur = setSquareUnits(base, null, 13650, false);
    expect(draftToSave(cur)).toEqual({ quantity: 13650, distribution: [], sublocation: null });
  });
});

describe('more than 30 in a square', () => {
  it('8 · E 35: 30 stay, 5 to F as a line pallet (03-3740BK)', () => {
    const base = rowDraft(
      row(
        35,
        'ROW 1',
        ['E'],
        [
          { type: 'TOWER', count: 1, units_each: 30 },
          { type: 'LINE', count: 1, units_each: 3 },
        ]
      )
    );
    expect(proposalFor(sq(base, 'E'), false)).toEqual({ kind: 'overflow', keep: 30, rest: 5 });
    const cur = overflowTo(base, 'E', 'F', false);
    expect(draftToSave(cur)).toEqual({
      quantity: 35,
      distribution: [
        { type: 'BASE', count: 1, units_each: 18, square: 'E' },
        { type: 'TOP', count: 1, units_each: 12, square: 'E' },
        { type: 'LINE_PALLET', count: 1, units_each: 5, square: 'F' },
      ],
      sublocation: ['E', 'F'],
    });
  });

  it('14 · B 137: each tapped letter takes up to 30', () => {
    let d = rowDraft(row(137, 'ROW 34', ['B']));
    for (const l of ['C', 'D', 'E', 'F']) d = overflowTo(d, 'B', l, false);
    expect(d.squares.map((s) => [s.letter, s.units])).toEqual([
      ['B', 30],
      ['C', 30],
      ['D', 30],
      ['E', 30],
      ['F', 17],
    ]);
    expect(proposalFor(sq(d, 'B'), false)).toBeNull();
    expect(draftQuantity(d)).toBe(137);
  });
});

describe('a pallet lifted', () => {
  const base = rowDraft(
    row(
      60,
      'ROW 31',
      ['B', 'C'],
      [
        { type: 'BASE', count: 1, units_each: 18, square: 'B' },
        { type: 'TOP', count: 1, units_each: 12, square: 'B' },
        { type: 'BASE', count: 1, units_each: 18, square: 'C' },
        { type: 'TOP', count: 1, units_each: 12, square: 'C' },
      ]
    )
  );

  it('12 · its type changed: the rule offers it back', () => {
    const i = sq(base, 'B').pallets.findIndex((p) => p.type === 'TOP');
    const cur = setPalletType(base, 'B', i, 'LINE_PALLET');
    expect(proposalFor(sq(cur, 'B'), false)?.kind).toBe('rule');
    expect(draftChanges(base, cur).map((c) => c.square)).toEqual(['B']);
  });

  it('to another letter, its bikes with it; an empty letter starts a square', () => {
    const i = sq(base, 'C').pallets.findIndex((p) => p.type === 'TOP');
    const cur = movePallet(base, 'C', i, 'D');
    expect(cur.squares.map((s) => [s.letter, s.units])).toEqual([
      ['B', 30],
      ['C', 18],
      ['D', 12],
    ]);
    expect(draftToSave(cur).sublocation).toEqual(['B', 'C', 'D']);
  });

  it('deleted: its bikes stay as loose', () => {
    const cur = deletePallet(base, 'B', 1);
    expect(looseOf(sq(cur, 'B'))).toBe(12);
    expect(draftQuantity(cur)).toBe(60);
  });

  it('a square emptied leaves the row', () => {
    const cur = moveSquare(base, 'C', 'A');
    expect(draftToSave(cur).sublocation).toEqual(['A', 'B']);
    expect(draftToSave(cur).quantity).toBe(60);
  });
});

describe('a clash', () => {
  it('13 · squares someone else changed take the fresh figure; the rest keep the edit', () => {
    const r = row(
      54,
      'ROW 25',
      ['A', 'B'],
      [
        { type: 'BASE', count: 1, units_each: 18, square: 'A' },
        { type: 'TOP', count: 1, units_each: 12, square: 'A' },
        { type: 'TOWER', count: 1, units_each: 24, square: 'B' },
      ]
    );
    const base = rowDraft(r);
    const cur = acceptRule(base, 'B');
    const fresh = rowDraft({
      ...r,
      quantity: 53,
      distribution: [
        { type: 'BASE', count: 1, units_each: 18, square: 'A' },
        { type: 'TOP', count: 1, units_each: 11, square: 'A' },
        { type: 'TOWER', count: 1, units_each: 24, square: 'B' },
      ],
    });
    const out = rebaseDraft(base, cur, fresh);
    expect(sq(out, 'A').units).toBe(29);
    expect(sq(out, 'B').pallets).toEqual(sq(cur, 'B').pallets);
    expect(draftQuantity(out)).toBe(53);
  });
});
