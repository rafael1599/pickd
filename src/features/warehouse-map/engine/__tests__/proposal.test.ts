import { describe, expect, it } from 'vitest';
import { ZONES, calculateLayout, defaultEngineState, type StripSegment } from '..';

type Hall = Extract<StripSegment, { type: 'hall' }>;
const isHall = (s: StripSegment): s is Hall => s.type === 'hall' && !s.isExtraOnly;

// Bay 2 North, ?proposal=h75 (Rafael, 7 Oct 2026): halls of 75" or more, at
// most 4 rows together, a post on the edge of a hall and not in a square.
describe('bay2_north proposal h75', () => {
  const config = ZONES.bay2_north;
  const state = defaultEngineState({
    toggles: { west: false },
    fixedStrip: config.proposals!.h75,
  });
  const m = calculateLayout(config, state)!;

  it('keeps the 12 rows of today with both halls at 125"', () => {
    expect(m.nRows).toBe(12);
    expect(m.blocks).toEqual([4, 4, 4]);
    const halls = m.strip.filter(isHall);
    expect(halls.map((h) => h.w)).toEqual([125, 125]);
    expect(halls.every((h) => h.w >= 75)).toBe(true);
  });

  it('puts both posts on the west edge of a hall, no more than 10" out, and loses no square', () => {
    expect(m.lost).toHaveLength(0);
    const halls = m.strip.filter(isHall);
    for (const p of config.posts!) {
      const h = halls.find((s) => p.x >= s.x && p.x <= s.x + s.w)!;
      expect(h).toBeDefined();
      expect(p.x + p.size / 2 - h.x).toBeLessThanOrEqual(10);
    }
  });

  it('counts the pallets to move: 3 for a row on the wall, 1 for a middle row', () => {
    const byRow = new Map(m.validCells.map((c) => [c.row.num, c.toMove]));
    const rows = m.strip.flatMap((s) => (s.type === 'block' ? s.rows.map((r) => r.num) : []));
    expect(rows.map((n) => byRow.get(n))).toEqual([3, 2, 1, 0, 0, 1, 1, 0, 0, 1, 2, 3]);
  });

  it('leaves the floor as it is without the param', () => {
    const today = calculateLayout(config, defaultEngineState({ toggles: { west: false } }))!;
    expect(today.blocks).toEqual([2, 2, 2, 2, 2, 2]);
    expect(today.validCells.every((c) => c.toMove === undefined)).toBe(true);
  });
});

describe('bay2_north proposal h75x3 — a third hall', () => {
  const config = ZONES.bay2_north;
  const m = calculateLayout(
    config,
    defaultEngineState({ toggles: { west: false }, fixedStrip: config.proposals!.h75x3 })
  )!;

  it('keeps 12 rows with three halls of 91"', () => {
    expect(m.nRows).toBe(12);
    expect(m.strip.filter(isHall).map((h) => h.w)).toEqual([91, 91, 91]);
  });

  it('loses one square to P5 and none to P6', () => {
    expect(m.lost).toHaveLength(1);
    expect(m.hits.map((h) => h.source.id)).toEqual([5]);
  });

  it('halves the pallets to move', () => {
    const rows = m.strip.flatMap((s) => (s.type === 'block' ? s.rows : []));
    const byRow = new Map(m.validCells.map((c) => [c.row.num, c.toMove]));
    expect(rows.map((r) => byRow.get(r.num))).toEqual([2, 1, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1]);
  });
});

describe('bay2_north proposal h75x4 — a fourth hall', () => {
  const config = ZONES.bay2_north;
  const m = calculateLayout(
    config,
    defaultEngineState({ toggles: { west: false }, fixedStrip: config.proposals!.h75x4 })
  )!;

  it('fits 11 rows with four halls of 75" or more and fills the zone', () => {
    expect(m.nRows).toBe(11);
    const halls = m.strip.filter(isHall).map((h) => h.w);
    expect(halls).toHaveLength(4);
    expect(halls.every((w) => w >= 75)).toBe(true);
    expect(m.extra).toBe(0);
  });

  it('loses one square to P5 and keeps P6 on a hall edge', () => {
    expect(m.hits.map((h) => h.source.id)).toEqual([5]);
    expect(m.lost).toHaveLength(1);
  });
});

describe('bay2_north proposal ew — east–west halls open at both ends', () => {
  const config = ZONES.bay2_north;
  const m = calculateLayout(
    config,
    defaultEngineState({ toggles: { west: false }, isEW: true, fixedStrip: config.proposals!.ew })
  )!;

  it('lays 6 rows of 14 squares between a 75" hall on each side wall', () => {
    expect(m.nRows).toBe(6);
    expect(m.deep).toBe(14);
    expect(m.blocks.every((b) => b <= 2)).toBe(true);
    expect(m.margins.left).toBe(75);
    expect(m.margins.right).toBe(75);
    expect(m.obstacles.filter((o) => o.id.endsWith('_cross')).map((o) => o.w)).toEqual([75, 75]);
  });

  it('keeps both posts in the hall, within 10" of a row', () => {
    expect(m.lost).toHaveLength(0);
    const halls = m.strip.filter(isHall);
    for (const p of config.posts!) {
      const h = halls.find((s) => p.y >= s.x && p.y <= s.x + s.w)!;
      expect(h).toBeDefined();
      expect(h.x + h.w - (p.y - p.size / 2)).toBeLessThanOrEqual(10);
    }
  });

  it('only the row on the north wall needs a pallet moved', () => {
    const rows = m.strip.flatMap((s) => (s.type === 'block' ? s.rows : []));
    const byRow = new Map(m.validCells.map((c) => [c.row.num, c.toMove]));
    expect(rows.map((r) => byRow.get(r.num))).toEqual([1, 0, 0, 0, 0, 0]);
  });
});
