import { describe, expect, it } from 'vitest';
import { boxesTotal, squaredGroups, squaresOf, unitsPerSquare } from '../boxSquares';
import type { DistributionItem } from '../../schemas/inventory.schema';

const T = (count: number, units_each: number, square?: string): DistributionItem => ({
  type: 'TOWER',
  count,
  units_each,
  ...(square ? { square } : {}),
});

describe('boxSquares', () => {
  it('adds the boxes up, ignoring malformed groups', () => {
    expect(boxesTotal([T(3, 30), T(1, 25), { type: 'LINE', count: 0, units_each: 5 }])).toBe(115);
    expect(boxesTotal(null)).toBe(0);
  });

  it('knows each square only when every group says its square', () => {
    expect(unitsPerSquare([T(1, 15, 'C'), T(1, 30, 'D')])).toEqual(
      new Map([
        ['C', 15],
        ['D', 30],
      ])
    );
    expect(unitsPerSquare([T(1, 15, 'C'), T(1, 30)])).toBeNull();
    expect(unitsPerSquare([])).toBeNull();
  });

  it('puts an unsplit row in its first square and merges equal groups (03-3982BL ROW 30)', () => {
    const g = squaredGroups([T(1, 25), T(3, 30), T(1, 30, 'G')], ['G', 'F']);
    expect(g).toEqual([T(3, 30, 'F'), T(1, 25, 'F'), T(1, 30, 'G')]);
    expect(squaresOf(g)).toEqual(['F', 'G']);
  });

  it('outside a ROW the groups carry no square', () => {
    expect(squaredGroups([T(1, 30, 'F'), T(1, 30)], null)).toEqual([T(2, 30)]);
  });
});
