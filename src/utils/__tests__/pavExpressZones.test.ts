import { describe, it, expect } from 'vitest';
import { getPavExpressZone } from '../pavExpressZones';

describe('getPavExpressZone', () => {
  it('identifies Zone 1 prefixes correctly', () => {
    expect(getPavExpressZone('10012')).toBe('zone1');
    expect(getPavExpressZone('10451')).toBe('zone1');
    expect(getPavExpressZone('11201-1234')).toBe('zone1');
    expect(getPavExpressZone('11691')).toBe('zone1');
  });

  it('identifies Zone 2 prefixes correctly', () => {
    expect(getPavExpressZone('11001')).toBe('zone2');
    expect(getPavExpressZone('11550')).toBe('zone2');
    expect(getPavExpressZone('11791')).toBe('zone2');
    expect(getPavExpressZone('12010')).toBe('zone2');
  });

  it('identifies Zone 3 prefixes correctly', () => {
    expect(getPavExpressZone('08065')).toBe('zone3');
    expect(getPavExpressZone('08816')).toBe('zone3');
    expect(getPavExpressZone('19104')).toBe('zone3');
    expect(getPavExpressZone('19401')).toBe('zone3');
  });

  it('returns null for ZIPs outside PAV Express zones', () => {
    expect(getPavExpressZone('90210')).toBeNull(); // California
    expect(getPavExpressZone('33101')).toBeNull(); // Florida
    expect(getPavExpressZone('')).toBeNull();
    expect(getPavExpressZone(null)).toBeNull();
  });
});
