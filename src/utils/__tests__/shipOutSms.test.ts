import { describe, expect, it } from 'vitest';
import {
  buildShipOutSmsBody,
  buildShipOutSmsUrl,
  computeShipOutMetrics,
  detectSmsPlatform,
  normalizeRecipients,
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
    expect(body).toBe(
      [
        'READY TO SHIP:',
        '',
        'MIAMI BEACH BICYCLE CENTER INC',
        '746-5TH STREET',
        'MIAMI BEACH, FL 33139',
        '',
        'ORDER #: 879807',
        'PALLETS: 1',
        'PARTS: 1',
        'WEIGHT: 40 LBS',
      ].join('\n')
    );
  });

  it('omits address lines that are blank without leaving gaps', () => {
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
    expect(body).toContain('BOSTON, MA');
    expect(body).not.toContain('null');
  });
});

describe('normalizeRecipients', () => {
  it('strips formatting and keeps digits + leading plus', () => {
    expect(normalizeRecipients(['+1 (914) 426-8047'])).toEqual(['+19144268047']);
    expect(normalizeRecipients(['914.426.8047'])).toEqual(['9144268047']);
  });

  it('parses newline / comma-separated strings', () => {
    expect(normalizeRecipients('+19144268047\n+13055551212')).toEqual([
      '+19144268047',
      '+13055551212',
    ]);
    expect(normalizeRecipients('+19144268047, +13055551212')).toEqual([
      '+19144268047',
      '+13055551212',
    ]);
  });

  it('drops empties and obviously bad entries', () => {
    expect(normalizeRecipients(['', '   ', 'abc', '123'])).toEqual([]);
    // 7-15 digits required
    expect(normalizeRecipients(['12345'])).toEqual([]);
    expect(normalizeRecipients(['1234567'])).toEqual(['1234567']);
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
  const recipients = ['+19144268047', '+13055551212'];
  const body = 'READY TO SHIP:\nORDER #: 1';

  it('Android: numbers in path, body in query', () => {
    const url = buildShipOutSmsUrl(recipients, body, 'android');
    expect(url.startsWith('sms:+19144268047,+13055551212?body=')).toBe(true);
    expect(url).toContain(encodeURIComponent(body));
  });

  it('iOS: uses /open?addresses= form', () => {
    const url = buildShipOutSmsUrl(recipients, body, 'ios');
    expect(url.startsWith('sms:/open?addresses=+19144268047,+13055551212&body=')).toBe(true);
    expect(url).toContain(encodeURIComponent(body));
  });

  it('other: falls back to Android form', () => {
    const url = buildShipOutSmsUrl(recipients, body, 'other');
    expect(url.startsWith('sms:')).toBe(true);
    expect(url).toContain('?body=');
  });

  it('encodes recipients through normalizeRecipients before joining', () => {
    const url = buildShipOutSmsUrl(['+1 (914) 426-8047'], 'hi', 'android');
    expect(url).toBe('sms:+19144268047?body=hi');
  });

  it('preserves newlines via URL encoding so the SMS app keeps formatting', () => {
    const multilineBody = 'line1\nline2';
    const url = buildShipOutSmsUrl(recipients, multilineBody, 'android');
    expect(url).toContain('line1%0Aline2');
  });
});
