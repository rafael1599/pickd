import { describe, it, expect } from 'vitest';
import { autoClassifyShippingType, isFedexOrder } from '../shippingClassification';

describe('autoClassifyShippingType', () => {
  it('returns fedex for 1 light bike', () => {
    const items = [{ sku: '03-1000BL', pickingQty: 1, sku_metadata: { is_bike: true } }];
    const weights = { '03-1000BL': 10 };
    expect(autoClassifyShippingType(items, weights)).toBe('fedex');
  });

  it('returns fedex for 4 light bikes (boundary)', () => {
    const items = [{ sku: '03-1000BL', pickingQty: 4, sku_metadata: { is_bike: true } }];
    const weights = { '03-1000BL': 5 };
    expect(autoClassifyShippingType(items, weights)).toBe('fedex');
  });

  it('returns regular for 5 light bikes (boundary)', () => {
    const items = [{ sku: '03-1000BL', pickingQty: 5, sku_metadata: { is_bike: true } }];
    const weights = { '03-1000BL': 5 };
    expect(autoClassifyShippingType(items, weights)).toBe('regular');
  });

  it('returns regular for 5 bikes with metadata', () => {
    const items = [{ sku: '06-4515BK', pickingQty: 5, sku_metadata: { is_bike: true } }];
    expect(autoClassifyShippingType(items, {})).toBe('regular');
  });

  it('returns fedex for a 50-part order — parts never force regular', () => {
    const items = [{ sku: '98-6860', pickingQty: 50, sku_metadata: { is_bike: false } }];
    const weights = { '98-6860': 2 };
    expect(autoClassifyShippingType(items, weights)).toBe('fedex');
  });

  it('returns fedex for 4 bikes + many parts (parts do not count)', () => {
    const items = [
      { sku: '03-1000BL', pickingQty: 4, sku_metadata: { is_bike: true } },
      { sku: '98-6860', pickingQty: 30, sku_metadata: { is_bike: false } },
      { sku: '32-0557', pickingQty: 12, sku_metadata: { is_bike: false } },
    ];
    const weights = { '03-1000BL': 30, '98-6860': 2, '32-0557': 1 };
    expect(autoClassifyShippingType(items, weights)).toBe('fedex');
  });

  it('returns regular for bikes summing to 5 across SKUs', () => {
    const items = [
      { sku: '03-1000BL', pickingQty: 2, sku_metadata: { is_bike: true } },
      { sku: '03-2000GY', pickingQty: 3, sku_metadata: { is_bike: true } },
    ];
    const weights = { '03-1000BL': 30, '03-2000GY': 30 };
    expect(autoClassifyShippingType(items, weights)).toBe('regular');
  });

  it('returns regular for 1 heavy item (60 lbs) regardless of count or type', () => {
    const items = [{ sku: 'SKU-HEAVY', pickingQty: 1 }];
    const weights = { 'SKU-HEAVY': 60 };
    expect(autoClassifyShippingType(items, weights)).toBe('regular');
  });

  it('returns regular when a heavy part rides along with light items', () => {
    const items = [
      { sku: '03-1000BL', pickingQty: 2, sku_metadata: { is_bike: true } },
      { sku: '98-6860', pickingQty: 1, sku_metadata: { is_bike: false } },
      { sku: 'SKU-HEAVY', pickingQty: 1 },
    ];
    const weights = { '03-1000BL': 3, '98-6860': 5, 'SKU-HEAVY': 55 };
    expect(autoClassifyShippingType(items, weights)).toBe('regular');
  });

  it('is_bike=true wins over non-bike naming (counts toward threshold)', () => {
    const items = [{ sku: 'CUSTOM-BIKE', pickingQty: 5, sku_metadata: { is_bike: true } }];
    expect(autoClassifyShippingType(items, {})).toBe('regular');
  });

  it('is_bike=false wins over any prefix (does not count)', () => {
    const items = [{ sku: '03-9999XX', pickingQty: 50, sku_metadata: { is_bike: false } }];
    expect(autoClassifyShippingType(items, {})).toBe('fedex');
  });

  it('a combined order of FedEx orders stays FedEx (3+3 bikes across sources)', () => {
    const items = [
      { sku: '03-1000BL', pickingQty: 3, source_order: '880696', sku_metadata: { is_bike: true } },
      { sku: '03-2000GY', pickingQty: 3, source_order: '880669', sku_metadata: { is_bike: true } },
    ];
    expect(autoClassifyShippingType(items, {})).toBe('fedex');
  });

  it('a combined order goes regular if one constituent is regular on its own', () => {
    const items = [
      { sku: '03-1000BL', pickingQty: 5, source_order: '880696', sku_metadata: { is_bike: true } },
      { sku: '03-2000GY', pickingQty: 1, source_order: '880669', sku_metadata: { is_bike: true } },
    ];
    expect(autoClassifyShippingType(items, {})).toBe('regular');
  });

  it('returns fedex for empty items array', () => {
    expect(autoClassifyShippingType([], {})).toBe('fedex');
  });

  it('returns fedex for items with 0 pickingQty', () => {
    const items = [
      { sku: '03-1000BL', pickingQty: 0 },
      { sku: '98-6860', pickingQty: 0 },
    ];
    const weights = { '03-1000BL': 10, '98-6860': 10 };
    expect(autoClassifyShippingType(items, weights)).toBe('fedex');
  });
});

describe('isFedexOrder with explicit transport companies', () => {
  it('returns true when transport_company is FEDEX', () => {
    expect(
      isFedexOrder({ transport_company: 'FEDEX', items: [{ sku: '03-1000BL', pickingQty: 10 }] })
    ).toBe(true);
  });

  it('returns false when transport_company is RIST or R+L (freight carriers)', () => {
    expect(
      isFedexOrder({ transport_company: 'RIST', items: [{ sku: '03-1000BL', pickingQty: 1 }] })
    ).toBe(false);
    expect(
      isFedexOrder({ transport_company: 'R+L', items: [{ sku: '03-1000BL', pickingQty: 2 }] })
    ).toBe(false);
    expect(
      isFedexOrder({ transport_company: 'DAYLIGHT', items: [{ sku: '03-1000BL', pickingQty: 1 }] })
    ).toBe(false);
  });

  it('returns false when transport_company is PICK UP', () => {
    expect(
      isFedexOrder({ transport_company: 'PICK UP', items: [{ sku: '03-1000BL', pickingQty: 1 }] })
    ).toBe(false);
  });
});
