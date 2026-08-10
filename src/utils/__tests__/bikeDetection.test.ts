import { describe, it, expect } from 'vitest';
import { isBikeSku, isBikeSkuPattern } from '../bikeDetection';

describe('bikeDetection', () => {
  describe('isBikeSkuPattern', () => {
    it('detects standard bike SKU patterns correctly', () => {
      expect(isBikeSkuPattern('03-4664YL')).toBe(true);
      expect(isBikeSkuPattern('01-1234BK')).toBe(true);
      expect(isBikeSkuPattern('05-9999RD')).toBe(true);
      expect(isBikeSkuPattern('06-1000WH')).toBe(true);
      expect(isBikeSkuPattern('07-5555GR')).toBe(true);
    });

    it('returns false for non-bike SKUs', () => {
      expect(isBikeSkuPattern('PEDAL-100')).toBe(false);
      expect(isBikeSkuPattern('TOOL-KIT')).toBe(false);
      expect(isBikeSkuPattern('')).toBe(false);
      expect(isBikeSkuPattern(null)).toBe(false);
    });
  });

  describe('isBikeSku', () => {
    it('returns true for 03-4664YL when is_bike in DB metadata is missing or null', () => {
      expect(isBikeSku('03-4664YL', { is_bike: null, weight_lbs: 45 })).toBe(true);
      expect(isBikeSku('03-4664YL', { is_bike: false, weight_lbs: 2.7 })).toBe(false);
      expect(isBikeSku({ sku: '03-4664YL', is_bike: null, weight_lbs: 45 })).toBe(true);
    });

    it('returns true for items with weight >= 15 lbs', () => {
      expect(isBikeSku('UNKNOWN-HEAVY-SKU', { is_bike: null, weight_lbs: 35 })).toBe(true);
      expect(isBikeSku({ sku: 'CUSTOM-BIKE', weight_lbs: 45 })).toBe(true);
    });

    it('returns true when is_bike is explicitly true in metadata', () => {
      expect(isBikeSku('SPECIAL-BIKE', { is_bike: true })).toBe(true);
    });

    it('returns false for actual light parts with is_bike false and non-bike SKU', () => {
      expect(isBikeSku('PEDAL-SET', { is_bike: false, weight_lbs: 1.5 })).toBe(false);
      expect(isBikeSku('CHAIN-LUBE', { is_bike: false, weight_lbs: 0.5 })).toBe(false);
    });
  });
});
