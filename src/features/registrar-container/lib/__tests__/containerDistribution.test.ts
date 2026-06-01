import { describe, expect, it } from 'vitest';
import { containerDistribution, formatTowersLines } from '../containerDistribution';

describe('containerDistribution (towers/lines rule: line<=5, >=18 becomes a tower)', () => {
  // Cases validated against Rafael's hand-annotated examples.
  const cases: Array<[number, string]> = [
    [0, '—'],
    [3, '1L'],
    [4, '1L'],
    [5, '1L'],
    [9, '2L'],
    [11, '3L'],
    [13, '3L'],
    [17, '4L'],
    [18, '1T'], // boundary: 18 rounds up to a tower
    [20, '1T'],
    [21, '1T'],
    [23, '1T'],
    [25, '1T'],
    [28, '1T'],
    [41, '1T 3L'],
    [44, '1T 3L'],
    [55, '2T'], // 30 + 25(>=18) -> 2T
    [59, '2T'],
    [66, '2T 2L'],
    [94, '3T 1L'],
    [109, '4T'], // 90 + 19(>=18) -> 4T
    [114, '4T'], // 90 + 24(>=18) -> 4T
    [168, '6T'], // 150 + 18(>=18) -> 6T
  ];

  it.each(cases)('qty %i -> %s', (qty, expected) => {
    expect(formatTowersLines(qty)).toBe(expected);
  });

  it('never emits a line count of 6+ (would be a tower)', () => {
    for (let q = 1; q <= 1000; q++) {
      const { lines } = containerDistribution(q);
      expect(lines).toBeLessThan(6);
    }
  });
});
