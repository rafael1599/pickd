import { describe, expect, it } from 'vitest';
import {
  buildShipOutSmsBody,
  buildShipOutSmsUrl,
  computeShipOutMetrics,
  detectSmsPlatform,
  type ShipOutSmsCustomer,
  type ShipOutSmsOrder,
  type ShipOutSmsSkuMeta,
} from '../shipOutSms';

const customer: ShipOutSmsCustomer = {
  name: 'Miami Beach Bicycle Center Inc',
  street: '746-5th Street',
  city: 'Miami Beach',
  state: 'FL',
  zip_code: '33139',
};

const skuMeta: Record<string, ShipOutSmsSkuMeta> = {
  'BIKE-A': { is_bike: true, weight_lbs: 35 },
  'BIKE-B': { is_bike: true, weight_lbs: 32 },
  'PART-X': { is_bike: false, weight_lbs: 1.5 },
};

describe('computeShipOutMetrics', () => {
  it('splits bikes and parts by is_bike flag', () => {
    const order: ShipOutSmsOrder = {
      order_number: '879807',
      pallets_qty: 1,
      total_weight_lbs: null,
      items: [
        { sku: 'BIKE-A', pickingQty: 2 },
        { sku: 'PART-X', pickingQty: 3 },
      ],
    };
    const m = computeShipOutMetrics(order, skuMeta);
    expect(m.bikes).toBe(2);
    expect(m.parts).toBe(3);
  });

  it('adds 40lb per pallet by default', () => {
    const order: ShipOutSmsOrder = {
      order_number: '1',
      pallets_qty: 2,
      total_weight_lbs: null,
      items: [{ sku: 'BIKE-A', pickingQty: 1 }],
    };
    // 1×35 + 2×40 = 115
    expect(computeShipOutMetrics(order, skuMeta).weightLbs).toBe(115);
  });

  it('skips pallet weight for FedEx orders', () => {
    const order: ShipOutSmsOrder = {
      order_number: '1',
      pallets_qty: 2,
      total_weight_lbs: null,
      shipping_type: 'fedex',
      items: [{ sku: 'PART-X', pickingQty: 4 }],
    };
    // 4×1.5 + 0 pallet weight = 6
    expect(computeShipOutMetrics(order, skuMeta).weightLbs).toBe(6);
  });

  it('honors persisted total_weight_lbs override when > 0', () => {
    const order: ShipOutSmsOrder = {
      order_number: '1',
      pallets_qty: 1,
      total_weight_lbs: 200,
      items: [{ sku: 'BIKE-A', pickingQty: 1 }],
    };
    expect(computeShipOutMetrics(order, skuMeta).weightLbs).toBe(200);
  });

  it('defaults pallets to 1 when null', () => {
    const order: ShipOutSmsOrder = {
      order_number: '1',
      pallets_qty: null,
      total_weight_lbs: null,
      items: [],
    };
    expect(computeShipOutMetrics(order, skuMeta).pallets).toBe(1);
  });

  it('treats SKUs missing from skuMeta as parts with 0 weight', () => {
    const order: ShipOutSmsOrder = {
      order_number: '1',
      pallets_qty: 1,
      total_weight_lbs: null,
      items: [{ sku: 'UNKNOWN', pickingQty: 5 }],
    };
    const m = computeShipOutMetrics(order, skuMeta);
    expect(m.parts).toBe(5);
    expect(m.bikes).toBe(0);
    expect(m.weightLbs).toBe(40); // only pallet weight
  });
});

describe('buildShipOutSmsBody', () => {
  it('matches the example format Rafael ships today', () => {
    const order: ShipOutSmsOrder = {
      order_number: '879807',
      pallets_qty: 1,
      total_weight_lbs: 40,
      items: [{ sku: 'PART-X', pickingQty: 1 }],
    };
    const metrics = computeShipOutMetrics(order, skuMeta);
    const body = buildShipOutSmsBody(customer, order, metrics);
    // Address fields intentionally omitted (idea-114); BIKES: 0 also omitted.
    expect(body).toBe(
      [
        'READY TO SHIP:',
        '',
        'MIAMI BEACH BICYCLE CENTER INC',
        '',
        'ORDER #: 879807',
        'PALLETS: 1',
        'PARTS: 1',
        'WEIGHT: 40 LBS',
      ].join('\n')
    );
  });

  it('omits BIKES and PARTS lines when both counts are zero', () => {
    const order: ShipOutSmsOrder = {
      order_number: '500',
      pallets_qty: 1,
      total_weight_lbs: 20,
      items: [],
    };
    const body = buildShipOutSmsBody(customer, order, {
      pallets: 1,
      parts: 0,
      bikes: 0,
      weightLbs: 20,
    });
    expect(body).not.toContain('BIKES');
    expect(body).not.toContain('PARTS');
    expect(body).toContain('WEIGHT: 20 LBS');
  });

  it('never includes customer street, city, state, or zip', () => {
    const order: ShipOutSmsOrder = {
      order_number: '700',
      pallets_qty: 1,
      total_weight_lbs: 30,
      items: [{ sku: 'BIKE-A', pickingQty: 1 }],
    };
    const metrics = computeShipOutMetrics(order, skuMeta);
    const body = buildShipOutSmsBody(customer, order, metrics);
    expect(body).not.toContain('746-5TH STREET');
    expect(body).not.toContain('MIAMI BEACH, FL');
    expect(body).not.toContain('33139');
  });

  it('includes BIKES line with the auto-computed bike unit count', () => {
    const order: ShipOutSmsOrder = {
      order_number: '1000',
      pallets_qty: 1,
      total_weight_lbs: null,
      items: [
        { sku: 'BIKE-A', pickingQty: 2 },
        { sku: 'BIKE-B', pickingQty: 1 },
        { sku: 'PART-X', pickingQty: 4 },
      ],
    };
    const metrics = computeShipOutMetrics(order, skuMeta);
    const body = buildShipOutSmsBody(customer, order, metrics);
    expect(body).toContain('BIKES: 3');
    expect(body).toContain('PARTS: 4');
  });

  it('omits PALLETS line for FedEx orders', () => {
    const order: ShipOutSmsOrder = {
      order_number: '999',
      pallets_qty: 1,
      total_weight_lbs: null,
      shipping_type: 'fedex',
      items: [{ sku: 'PART-X', pickingQty: 2 }],
    };
    const metrics = computeShipOutMetrics(order, skuMeta);
    const body = buildShipOutSmsBody(customer, order, metrics);
    expect(body).not.toContain('PALLETS');
    expect(body).toContain('PARTS: 2');
    expect(body).toContain('WEIGHT:');
  });

  it('keeps PALLETS line for non-FedEx orders', () => {
    const order: ShipOutSmsOrder = {
      order_number: '999',
      pallets_qty: 2,
      total_weight_lbs: null,
      shipping_type: 'regular',
      items: [{ sku: 'BIKE-A', pickingQty: 1 }],
    };
    const metrics = computeShipOutMetrics(order, skuMeta);
    const body = buildShipOutSmsBody(customer, order, metrics);
    expect(body).toContain('PALLETS: 2');
  });

  it('includes customer name (uppercased) but skips address entirely', () => {
    const sparse: ShipOutSmsCustomer = {
      name: 'Customer X',
      street: null,
      city: 'Boston',
      state: 'MA',
      zip_code: null,
    };
    const order: ShipOutSmsOrder = {
      order_number: 'N1',
      pallets_qty: 1,
      total_weight_lbs: 50,
      items: [],
    };
    const body = buildShipOutSmsBody(sparse, order, {
      pallets: 1,
      parts: 0,
      bikes: 0,
      weightLbs: 50,
    });
    expect(body).toContain('CUSTOMER X');
    expect(body).not.toContain('BOSTON');
    expect(body).not.toContain('null');
  });
});

describe('detectSmsPlatform', () => {
  it('detects iOS', () => {
    expect(
      detectSmsPlatform(
        'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15'
      )
    ).toBe('ios');
  });
  it('detects Android', () => {
    expect(detectSmsPlatform('Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36')).toBe(
      'android'
    );
  });
  it('falls back to other', () => {
    expect(detectSmsPlatform('Mozilla/5.0 (Macintosh; Intel Mac OS X)')).toBe('other');
  });
});

describe('buildShipOutSmsUrl', () => {
  const body = 'READY TO SHIP:\nORDER #: 1';

  it('Android: sms:?body= (no recipient)', () => {
    const url = buildShipOutSmsUrl(body, 'android');
    expect(url.startsWith('sms:?body=')).toBe(true);
    expect(url).toContain(encodeURIComponent(body));
  });

  it('iOS: sms:&body= (no recipient)', () => {
    const url = buildShipOutSmsUrl(body, 'ios');
    expect(url.startsWith('sms:&body=')).toBe(true);
    expect(url).toContain(encodeURIComponent(body));
  });

  it('other: falls back to Android form', () => {
    const url = buildShipOutSmsUrl(body, 'other');
    expect(url).toBe(`sms:?body=${encodeURIComponent(body)}`);
  });

  it('preserves newlines via URL encoding so the SMS app keeps formatting', () => {
    const multilineBody = 'line1\nline2';
    const url = buildShipOutSmsUrl(multilineBody, 'android');
    expect(url).toContain('line1%0Aline2');
  });
});
