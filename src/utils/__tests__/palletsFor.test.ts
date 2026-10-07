import { describe, expect, it } from 'vitest';
import { calculateBikeDistribution, palletsFor } from '../distributionCalculator';

const units = (d: ReturnType<typeof palletsFor>) =>
  d.reduce((s, g) => s + g.count * g.units_each, 0);

describe('palletsFor (idea-254, Rafael 6 Oct 2026)', () => {
  it.each([
    [
      30,
      [
        { type: 'BASE', count: 1, units_each: 18 },
        { type: 'TOP', count: 1, units_each: 12 },
      ],
    ],
    // 41 = 1 DS + a line pallet of 11
    [
      41,
      [
        { type: 'BASE', count: 1, units_each: 18 },
        { type: 'TOP', count: 1, units_each: 12 },
        { type: 'LINE_PALLET', count: 1, units_each: 11 },
      ],
    ],
    // 52 = 1 DS + an incomplete DS of 22 (base 18 + top 4)
    [
      52,
      [
        { type: 'BASE', count: 2, units_each: 18 },
        { type: 'TOP', count: 1, units_each: 12 },
        { type: 'TOP', count: 1, units_each: 4 },
      ],
    ],
    // 13–18 is a base of its own
    [
      45,
      [
        { type: 'BASE', count: 1, units_each: 18 },
        { type: 'BASE', count: 1, units_each: 15 },
        { type: 'TOP', count: 1, units_each: 12 },
      ],
    ],
    [16, [{ type: 'BASE', count: 1, units_each: 16 }]],
    [7, [{ type: 'LINE_PALLET', count: 1, units_each: 7 }]],
    [
      25,
      [
        { type: 'BASE', count: 1, units_each: 18 },
        { type: 'TOP', count: 1, units_each: 7 },
      ],
    ],
  ])('%i bikes', (qty, expected) => {
    expect(palletsFor(qty)).toEqual(expected);
  });

  it('never loses a unit', () => {
    for (let q = 0; q <= 400; q++) expect(units(palletsFor(q))).toBe(q);
  });

  it('kids bikes keep the old towers and lines', () => {
    expect(calculateBikeDistribution(37, true)).toEqual([
      { type: 'TOWER', count: 1, units_each: 30 },
      { type: 'LINE', count: 1, units_each: 5 },
      { type: 'LINE', count: 1, units_each: 2 },
    ]);
  });
});
