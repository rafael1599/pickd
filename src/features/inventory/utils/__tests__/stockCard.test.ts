import { describe, expect, it } from 'vitest';
import { cardThumbUrl, compactDistribution } from '../stockCard';

describe('compactDistribution', () => {
  // 03-3978BL in prod, 6 Oct 2026: two lines and eight towers of 30.
  const citizen = [
    { type: 'LINE' as const, count: 1, units_each: 4 },
    { type: 'LINE' as const, count: 1, units_each: 5 },
    { type: 'TOWER' as const, count: 8, units_each: 30 },
  ];

  it('draws one tower «8 × 30» and keeps two lines that hold different amounts', () => {
    expect(compactDistribution(citizen, 247)).toEqual([
      { type: 'TOWER', count: 8, unitsEach: 30 },
      { type: 'LINE', count: 1, unitsEach: 5 },
      { type: 'LINE', count: 1, unitsEach: 4 },
    ]);
  });

  it('merges entries of the same kind and amount', () => {
    expect(
      compactDistribution(
        [
          { type: 'TOWER', count: 1, units_each: 25 },
          { type: 'TOWER', count: 3, units_each: 30 },
          { type: 'TOWER', count: 1, units_each: 30 },
        ],
        145
      )
    ).toEqual([
      { type: 'TOWER', count: 4, unitsEach: 30 },
      { type: 'TOWER', count: 1, unitsEach: 25 },
    ]);
  });

  it('draws nothing when one unit is left, or there is nothing to draw', () => {
    expect(compactDistribution([{ type: 'LINE', count: 1, units_each: 1 }], 1)).toEqual([]);
    expect(compactDistribution(citizen, 0)).toEqual([]);
    expect(compactDistribution(null, 12)).toEqual([]);
    expect(compactDistribution([{ type: 'LINE', count: 0, units_each: 5 }], 5)).toEqual([]);
  });
});

describe('cardThumbUrl', () => {
  const R2 = 'https://pub-1a61139939fa4f3ba21ee7909510985c.r2.dev/';

  it('derives the thumb of a catalogue image and of a unit photo, keeping ?v=', () => {
    expect(cardThumbUrl(R2 + 'catalog/citizen.png')).toBe(R2 + 'catalog/thumbs/citizen.webp');
    expect(cardThumbUrl(R2 + 'photos/03-4470BK.webp?v=17')).toBe(
      R2 + 'photos/thumbs/03-4470BK.webp?v=17'
    );
  });

  it('leaves a URL that already is a thumb (a FedEx label) as it is', () => {
    const label = R2 + 'photos/returns/thumbs/777420118898.webp';
    expect(cardThumbUrl(label)).toBe(label);
    expect(cardThumbUrl(null)).toBeNull();
  });
});
