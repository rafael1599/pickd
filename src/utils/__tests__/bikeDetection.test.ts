import { describe, it, expect } from 'vitest';
import { isBikeSku } from '../bikeDetection';

describe('bikeDetection (Canonical DB is_bike Source of Truth)', () => {
  describe('isBikeSku', () => {
    it('returns true when is_bike is explicitly true in metadata', () => {
      expect(isBikeSku('03-4664YL', { is_bike: true, weight_lbs: 45 })).toBe(true);
      expect(isBikeSku('SPECIAL-BIKE', { is_bike: true })).toBe(true);
      expect(isBikeSku({ sku: '12-3456BK', is_bike: true })).toBe(true);
    });

    it('returns false when is_bike is explicitly false in metadata regardless of SKU format', () => {
      expect(isBikeSku('03-4664YL', { is_bike: false, weight_lbs: 45 })).toBe(false);
      expect(isBikeSku('12-3456BK', { is_bike: false, weight_lbs: 2.7 })).toBe(false);
      expect(isBikeSku('PEDAL-SET', { is_bike: false, weight_lbs: 1.5 })).toBe(false);
    });

    it('falls back to weight heuristic (>= 15 lbs) ONLY when is_bike is uncataloged / null in DB', () => {
      expect(isBikeSku('UNKNOWN-HEAVY-SKU', { is_bike: null, weight_lbs: 35 })).toBe(true);
      expect(isBikeSku({ sku: 'UNCATALOGED-ITEM', weight_lbs: 2.7 })).toBe(false);
    });
  });
});
