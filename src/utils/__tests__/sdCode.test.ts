import { describe, expect, it } from 'vitest';
import { sdCode } from '../sdCode';

describe('sdCode', () => {
  it('1 … 99 as they are', () => {
    expect(sdCode(1)).toBe('1');
    expect(sdCode(83)).toBe('83');
    expect(sdCode(99)).toBe('99');
  });

  it('then 1A … 9Z, without I, L, O', () => {
    expect(sdCode(100)).toBe('1A');
    expect(sdCode(107)).toBe('1H');
    expect(sdCode(108)).toBe('1J');
    expect(sdCode(122)).toBe('1Z');
    expect(sdCode(123)).toBe('2A');
    expect(sdCode(306)).toBe('9Z');
  });

  it('then 100 … 999, then 10A … 99Z, then 1000', () => {
    expect(sdCode(307)).toBe('100');
    expect(sdCode(1206)).toBe('999');
    expect(sdCode(1207)).toBe('10A');
    expect(sdCode(3276)).toBe('99Z');
    expect(sdCode(3277)).toBe('1000');
  });

  it('every code is different and never longer than its neighbours need', () => {
    const seen = new Set<string>();
    for (let n = 1; n <= 40000; n += 1) {
      const c = sdCode(n);
      expect(seen.has(c)).toBe(false);
      expect(c).not.toMatch(/[ILO]/);
      seen.add(c);
    }
    expect(sdCode(306).length).toBe(2);
  });
});
