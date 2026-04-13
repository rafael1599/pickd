import { describe, it, expect } from 'vitest';
import { autoClassifyShippingType } from '../shippingClassification';

describe('autoClassifyShippingType', () => {
  it('returns fedex for 1 light item', () => {
    const items = [{ sku: 'SKU-A', pickingQty: 1 }];
    const weights = { 'SKU-A': 10 };
    expect(autoClassifyShippingType(items, weights)).toBe('fedex');
  });

  it('returns fedex for 4 light items (boundary)', () => {
    const items = [{ sku: 'SKU-A', pickingQty: 4 }];
    const weights = { 'SKU-A': 5 };
    expect(autoClassifyShippingType(items, weights)).toBe('fedex');
  });

  it('returns regular for 5 light items (boundary)', () => {
    const items = [{ sku: 'SKU-A', pickingQty: 5 }];
    const weights = { 'SKU-A': 5 };
    expect(autoClassifyShippingType(items, weights)).toBe('regular');
  });

  it('returns regular for 1 heavy item (60 lbs) regardless of count', () => {
    const items = [{ sku: 'SKU-HEAVY', pickingQty: 1 }];
    const weights = { 'SKU-HEAVY': 60 };
    expect(autoClassifyShippingType(items, weights)).toBe('regular');
  });

  it('returns regular for mixed items when heavy rule wins (3 light + 1 heavy)', () => {
    const items = [
      { sku: 'SKU-A', pickingQty: 2 },
      { sku: 'SKU-B', pickingQty: 1 },
      { sku: 'SKU-HEAVY', pickingQty: 1 },
    ];
    const weights = { 'SKU-A': 3, 'SKU-B': 5, 'SKU-HEAVY': 55 };
    expect(autoClassifyShippingType(items, weights)).toBe('regular');
  });

  it('returns fedex for empty items array', () => {
    expect(autoClassifyShippingType([], {})).toBe('fedex');
  });

  it('returns fedex for items with 0 pickingQty', () => {
    const items = [
      { sku: 'SKU-A', pickingQty: 0 },
      { sku: 'SKU-B', pickingQty: 0 },
    ];
    const weights = { 'SKU-A': 10, 'SKU-B': 10 };
    expect(autoClassifyShippingType(items, weights)).toBe('fedex');
  });

  it('returns regular for multiple items summing to exactly 5', () => {
    const items = [
      { sku: 'SKU-A', pickingQty: 2 },
      { sku: 'SKU-B', pickingQty: 3 },
    ];
    const weights = { 'SKU-A': 5, 'SKU-B': 5 };
    expect(autoClassifyShippingType(items, weights)).toBe('regular');
  });
});
