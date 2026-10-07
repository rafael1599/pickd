import { describe, expect, it } from 'vitest';
import { boxesMismatch, mismatchLabel } from '../squareEdit';
import { squaredGroups } from '../../../../utils/boxSquares';
import type { DistributionItem } from '../../../../schemas/inventory.schema';

const T = (count: number, units_each: number, square?: string): DistributionItem => ({
  type: 'TOWER',
  count,
  units_each,
  ...(square ? { square } : {}),
});

// The editing itself is Edit squares (idea-258): squareDraft.test.ts.
describe('squareEdit', () => {
  // 03-3982BL ROW 30, F,G, 54 u, boxes 1×25 + 3×30.
  const base = squaredGroups([T(1, 25), T(3, 30)], ['F', 'G']);

  it('says the boxes do not match the quantity', () => {
    expect(boxesMismatch(base, 54)).toBe(-61);
    expect(mismatchLabel(-61)).toBe('−61 extra');
    expect(mismatchLabel(60)).toBe('+60 loose');
    expect(mismatchLabel(0)).toBeNull();
  });
});
