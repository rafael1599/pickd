import { describe, expect, it } from 'vitest';

import { lastThree, orderHeaderLabel, splitOrderNumbers } from '../orderLabel';

describe('lastThree', () => {
  it('returns the last 3 chars', () => {
    expect(lastThree('880121')).toBe('121');
    expect(lastThree('880083')).toBe('083');
  });
  it('returns the whole string when 3 or fewer chars', () => {
    expect(lastThree('12')).toBe('12');
    expect(lastThree('999')).toBe('999');
  });
  it('trims whitespace', () => {
    expect(lastThree('  880121 ')).toBe('121');
  });
});

describe('splitOrderNumbers', () => {
  it('splits on " / " and trims', () => {
    expect(splitOrderNumbers('880083 / 880121')).toEqual(['880083', '880121']);
  });
  it('handles null/empty', () => {
    expect(splitOrderNumbers(null)).toEqual([]);
    expect(splitOrderNumbers('')).toEqual([]);
  });
});

describe('orderHeaderLabel', () => {
  it('uses the fallback when there is no order number', () => {
    expect(orderHeaderLabel(null, 'STOCK DEDUCTION')).toEqual({
      kind: 'single',
      label: 'STOCK DEDUCTION',
      count: 0,
    });
  });

  it('shows a single order with full number', () => {
    expect(orderHeaderLabel('880083', 'fb')).toEqual({
      kind: 'single',
      label: '#880083',
      count: 1,
    });
  });

  it('shows exactly 2 merged as last-3 of each separated by " / "', () => {
    expect(orderHeaderLabel('880083 / 880121', 'fb')).toEqual({
      kind: 'pair',
      label: '083 / 121',
      count: 2,
    });
  });

  it('keeps 3+ merged as first + count (dropdown handled by caller)', () => {
    expect(orderHeaderLabel('880083 / 880121 / 880456', 'fb')).toEqual({
      kind: 'many',
      label: '#880083',
      count: 3,
    });
  });
});
