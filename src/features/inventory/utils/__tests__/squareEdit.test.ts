import { describe, expect, it } from 'vitest';
import {
  boxesMismatch,
  boxesToSave,
  mismatchLabel,
  moveGroup,
  overCap,
  setGroupNumber,
  splitGroup,
  squareChanges,
} from '../squareEdit';
import { squaredGroups } from '../../../../utils/boxSquares';
import type { DistributionItem } from '../../../../schemas/inventory.schema';

const T = (count: number, units_each: number, square?: string): DistributionItem => ({
  type: 'TOWER',
  count,
  units_each,
  ...(square ? { square } : {}),
});

describe('squareEdit', () => {
  // Case 1–2 of the study: 03-3982BL ROW 30, F,G, 54 u, boxes 1×25 + 3×30.
  const base = squaredGroups([T(1, 25), T(3, 30)], ['F', 'G']);

  it('says the boxes do not match the quantity', () => {
    expect(boxesMismatch(base, 54)).toBe(-61);
    expect(mismatchLabel(-61)).toBe('−61 extra');
    expect(mismatchLabel(60)).toBe('+60 loose');
    expect(mismatchLabel(0)).toBeNull();
  });

  it('F 115→30 · G 0→24, two changes, and then the boxes match', () => {
    let cur = setGroupNumber(base, 0, 'count', 1); // 3×30 → 1×30
    cur = setGroupNumber(cur, 1, 'units_each', 24); // 1×25 → 1×24
    cur = moveGroup(cur, 1, 'G');
    expect(squareChanges(base, cur)).toEqual([
      { square: 'F', before: 115, after: 30 },
      { square: 'G', before: 0, after: 24 },
    ]);
    expect(boxesMismatch(cur, 54)).toBe(0);
    expect(boxesToSave(cur, ['F', 'G'])).toEqual({
      distribution: [T(1, 30, 'F'), T(1, 24, 'G')],
      sublocation: ['F', 'G'],
    });
  });

  it('a count of 0 removes the group', () => {
    expect(setGroupNumber(base, 1, 'count', 0)).toEqual([T(3, 30, 'F')]);
  });

  it('splits one box out to move it (2×30 → 1×30 + 1×30)', () => {
    const { groups, index } = splitGroup([T(2, 30, 'H')], 0);
    expect(groups).toEqual([T(1, 30, 'H'), T(1, 30, 'H')]);
    expect(moveGroup(groups, index, 'I')).toEqual([T(1, 30, 'H'), T(1, 30, 'I')]);
  });

  it('a square left empty leaves the row', () => {
    const cur = moveGroup(squaredGroups([T(1, 30, 'H'), T(1, 30, 'I')], ['H', 'I']), 1, 'H');
    expect(boxesToSave(cur, ['H', 'I'])).toEqual({
      distribution: [T(2, 30, 'H')],
      sublocation: ['H'],
    });
  });

  it('warns a square over 45 (03-4034BK ROW 34 · B 137)', () => {
    expect(overCap([T(4, 30, 'B'), T(1, 17, 'B')])).toEqual([
      { square: 'B', before: 137, after: 137 },
    ]);
  });

  it('a regrouping with the same units is still a change', () => {
    expect(squareChanges([T(2, 15, 'C')], [T(1, 30, 'C')])).toEqual([
      { square: 'C', before: 30, after: 30 },
    ]);
  });
});
