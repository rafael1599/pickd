import { describe, it, expect } from 'vitest';
import { autoClassifyShippingType, isFedexOrder } from '../shippingClassification';

/** These cases pin the embedded-metadata path, so they opt out of the lookup
 *  explicitly. The argument is required precisely so that opting out is a
 *  visible choice and never an omission. */
const EMPTY_LOOKUP: ReadonlySet<string> = new Set();

describe('autoClassifyShippingType', () => {
  it('returns fedex for 1 light bike', () => {
    const items = [{ sku: '03-1000BL', pickingQty: 1, sku_metadata: { is_bike: true } }];
    const weights = { '03-1000BL': 10 };
    expect(autoClassifyShippingType(items, weights, EMPTY_LOOKUP)).toBe('fedex');
  });

  it('returns fedex for 4 light bikes (boundary)', () => {
    const items = [{ sku: '03-1000BL', pickingQty: 4, sku_metadata: { is_bike: true } }];
    const weights = { '03-1000BL': 5 };
    expect(autoClassifyShippingType(items, weights, EMPTY_LOOKUP)).toBe('fedex');
  });

  it('returns regular for 5 light bikes (boundary)', () => {
    const items = [{ sku: '03-1000BL', pickingQty: 5, sku_metadata: { is_bike: true } }];
    const weights = { '03-1000BL': 5 };
    expect(autoClassifyShippingType(items, weights, EMPTY_LOOKUP)).toBe('regular');
  });

  it('returns regular for 5 bikes with metadata', () => {
    const items = [{ sku: '06-4515BK', pickingQty: 5, sku_metadata: { is_bike: true } }];
    expect(autoClassifyShippingType(items, {}, EMPTY_LOOKUP)).toBe('regular');
  });

  it('returns fedex for a 50-part order — parts never force regular', () => {
    const items = [{ sku: '98-6860', pickingQty: 50, sku_metadata: { is_bike: false } }];
    const weights = { '98-6860': 2 };
    expect(autoClassifyShippingType(items, weights, EMPTY_LOOKUP)).toBe('fedex');
  });

  it('returns fedex for 4 bikes + many parts (parts do not count)', () => {
    const items = [
      { sku: '03-1000BL', pickingQty: 4, sku_metadata: { is_bike: true } },
      { sku: '98-6860', pickingQty: 30, sku_metadata: { is_bike: false } },
      { sku: '32-0557', pickingQty: 12, sku_metadata: { is_bike: false } },
    ];
    const weights = { '03-1000BL': 30, '98-6860': 2, '32-0557': 1 };
    expect(autoClassifyShippingType(items, weights, EMPTY_LOOKUP)).toBe('fedex');
  });

  it('returns regular for bikes summing to 5 across SKUs', () => {
    const items = [
      { sku: '03-1000BL', pickingQty: 2, sku_metadata: { is_bike: true } },
      { sku: '03-2000GY', pickingQty: 3, sku_metadata: { is_bike: true } },
    ];
    const weights = { '03-1000BL': 30, '03-2000GY': 30 };
    expect(autoClassifyShippingType(items, weights, EMPTY_LOOKUP)).toBe('regular');
  });

  it('returns regular for 1 heavy item (60 lbs) regardless of count or type', () => {
    const items = [{ sku: 'SKU-HEAVY', pickingQty: 1 }];
    const weights = { 'SKU-HEAVY': 60 };
    expect(autoClassifyShippingType(items, weights, EMPTY_LOOKUP)).toBe('regular');
  });

  it('returns regular when a heavy part rides along with light items', () => {
    const items = [
      { sku: '03-1000BL', pickingQty: 2, sku_metadata: { is_bike: true } },
      { sku: '98-6860', pickingQty: 1, sku_metadata: { is_bike: false } },
      { sku: 'SKU-HEAVY', pickingQty: 1 },
    ];
    const weights = { '03-1000BL': 3, '98-6860': 5, 'SKU-HEAVY': 55 };
    expect(autoClassifyShippingType(items, weights, EMPTY_LOOKUP)).toBe('regular');
  });

  it('is_bike=true wins over non-bike naming (counts toward threshold)', () => {
    const items = [{ sku: 'CUSTOM-BIKE', pickingQty: 5, sku_metadata: { is_bike: true } }];
    expect(autoClassifyShippingType(items, {}, EMPTY_LOOKUP)).toBe('regular');
  });

  it('is_bike=false wins over any prefix (does not count)', () => {
    const items = [{ sku: '03-9999XX', pickingQty: 50, sku_metadata: { is_bike: false } }];
    expect(autoClassifyShippingType(items, {}, EMPTY_LOOKUP)).toBe('fedex');
  });

  it('a combined order of FedEx orders stays FedEx (3+3 bikes across sources)', () => {
    const items = [
      { sku: '03-1000BL', pickingQty: 3, source_order: '880696', sku_metadata: { is_bike: true } },
      { sku: '03-2000GY', pickingQty: 3, source_order: '880669', sku_metadata: { is_bike: true } },
    ];
    expect(autoClassifyShippingType(items, {}, EMPTY_LOOKUP)).toBe('fedex');
  });

  it('a combined order goes regular if one constituent is regular on its own', () => {
    const items = [
      { sku: '03-1000BL', pickingQty: 5, source_order: '880696', sku_metadata: { is_bike: true } },
      { sku: '03-2000GY', pickingQty: 1, source_order: '880669', sku_metadata: { is_bike: true } },
    ];
    expect(autoClassifyShippingType(items, {}, EMPTY_LOOKUP)).toBe('regular');
  });

  it('returns fedex for empty items array', () => {
    expect(autoClassifyShippingType([], {}, EMPTY_LOOKUP)).toBe('fedex');
  });

  it('returns fedex for items with 0 pickingQty', () => {
    const items = [
      { sku: '03-1000BL', pickingQty: 0 },
      { sku: '98-6860', pickingQty: 0 },
    ];
    const weights = { '03-1000BL': 10, '98-6860': 10 };
    expect(autoClassifyShippingType(items, weights, EMPTY_LOOKUP)).toBe('fedex');
  });
});

describe('autoClassifyShippingType with a bikeSkus lookup (raw watchdog items)', () => {
  // Watchdog-created orders store items WITHOUT embedded sku_metadata — the
  // fetched lookup is the only bike signal for them.
  it('counts bikes via a Set lookup when items carry no metadata', () => {
    const items = [
      { sku: '06-4438BK', pickingQty: 2 },
      { sku: '06-4454BK', pickingQty: 2 },
      { sku: '07-3689WH', pickingQty: 2 },
    ];
    expect(
      autoClassifyShippingType(items, {}, new Set(['06-4438BK', '06-4454BK', '07-3689WH']))
    ).toBe('regular');
  });

  it('counts bikes via a sku→is_bike record lookup', () => {
    const items = [{ sku: '03-4635MN', pickingQty: 5 }];
    expect(autoClassifyShippingType(items, {}, { '03-4635MN': true })).toBe('regular');
    expect(autoClassifyShippingType(items, {}, { '03-4635MN': false })).toBe('fedex');
  });

  it('with an empty lookup, metadata-less items still count as parts', () => {
    const items = [{ sku: '06-4438BK', pickingQty: 10 }];
    expect(autoClassifyShippingType(items, {}, EMPTY_LOOKUP)).toBe('fedex');
  });

  it('embedded is_bike=false wins over Set membership', () => {
    const items = [{ sku: '03-9999XX', pickingQty: 50, sku_metadata: { is_bike: false } }];
    expect(autoClassifyShippingType(items, {}, new Set(['03-9999XX']))).toBe('fedex');
  });

  it('embedded is_bike=true works without the SKU being in the lookup', () => {
    const items = [{ sku: 'CUSTOM-BIKE', pickingQty: 5, sku_metadata: { is_bike: true } }];
    expect(autoClassifyShippingType(items, {}, new Set())).toBe('regular');
  });

  it('isFedexOrder auto-classifies raw items through the lookup', () => {
    const order = {
      shipping_type: null,
      transport_company: null,
      order_group: null,
      items: [{ sku: '06-4438BK', pickingQty: 10 }],
    };
    expect(isFedexOrder(order, {}, new Set(['06-4438BK']))).toBe(false);
    expect(isFedexOrder(order, {}, new Set())).toBe(true);
  });
});

describe('regression: order 881220 (13 bikes read as FedEx in DoubleCheckView)', () => {
  // The real cart, as the watchdog wrote it on 2026-08-20: 13 bike units over
  // 10 lines, no shipping_type, no transport_company, and — because it came
  // through pdf_import — no sku_metadata on any item. DoubleCheckView called
  // the classifier without a lookup, counted 0 bikes, and painted the order
  // FedEx while the Verification Board showed it as Regular.
  const items = [
    { sku: '03-4369BL', pickingQty: 1 },
    { sku: '03-4370BL', pickingQty: 1 },
    { sku: '03-4371BL', pickingQty: 1 },
    { sku: '03-4374GN', pickingQty: 3 },
    { sku: '03-4635MN', pickingQty: 1 },
    { sku: '03-4637MN', pickingQty: 2 },
    { sku: '06-4562BL', pickingQty: 1 },
    { sku: '06-4563BL', pickingQty: 1 },
    { sku: '06-4604OR', pickingQty: 1 },
    { sku: '06-4605OR', pickingQty: 1 },
  ];
  const bikeSkus = new Set(items.map((i) => i.sku));
  const order = {
    shipping_type: null,
    transport_company: null,
    order_group: null,
    items,
  };

  it('classifies as regular once the canonical lookup is supplied', () => {
    expect(isFedexOrder(order, {}, bikeSkus)).toBe(false);
  });

  it('classifies as regular from the stamped items alone, with no lookup', () => {
    // What the 20260820150000 trigger now guarantees: the flag rides on the
    // item, so a caller with no lookup of its own still gets the right answer.
    const stamped = items.map((i) => ({ ...i, sku_metadata: { is_bike: true } }));
    expect(isFedexOrder({ ...order, items: stamped }, {}, EMPTY_LOOKUP)).toBe(false);
  });
});

describe('isFedexOrder with explicit transport companies', () => {
  it('returns true when transport_company is FEDEX', () => {
    expect(
      isFedexOrder(
        { transport_company: 'FEDEX', items: [{ sku: '03-1000BL', pickingQty: 10 }] },
        {},
        EMPTY_LOOKUP
      )
    ).toBe(true);
  });

  it('returns false when transport_company is RIST or R+L (freight carriers)', () => {
    expect(
      isFedexOrder(
        { transport_company: 'RIST', items: [{ sku: '03-1000BL', pickingQty: 1 }] },
        {},
        EMPTY_LOOKUP
      )
    ).toBe(false);
    expect(
      isFedexOrder(
        { transport_company: 'R+L', items: [{ sku: '03-1000BL', pickingQty: 2 }] },
        {},
        EMPTY_LOOKUP
      )
    ).toBe(false);
    expect(
      isFedexOrder(
        { transport_company: 'DAYLIGHT', items: [{ sku: '03-1000BL', pickingQty: 1 }] },
        {},
        EMPTY_LOOKUP
      )
    ).toBe(false);
  });

  it('returns false when transport_company is PICK UP', () => {
    expect(
      isFedexOrder(
        { transport_company: 'PICK UP', items: [{ sku: '03-1000BL', pickingQty: 1 }] },
        {},
        EMPTY_LOOKUP
      )
    ).toBe(false);
  });
});
