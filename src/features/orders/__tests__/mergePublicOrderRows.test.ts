import { describe, expect, it } from 'vitest';
import { mergePublicOrderRows, type PublicOrderRow } from '../PublicOrderView';

function makeRow(overrides: Partial<PublicOrderRow>): PublicOrderRow {
  return {
    id: 'id-1',
    order_number: '880848',
    status: 'completed',
    items: [],
    notes: null,
    source_order_date: null,
    pallets_qty: 1,
    total_units: 0,
    load_number: null,
    created_at: '2026-07-20T10:00:00Z',
    updated_at: '2026-07-20T10:00:00Z',
    transport_company: null,
    total_weight_lbs: 0,
    pallet_photos: [],
    is_shipped: true,
    combine_meta: null,
    group_id: null,
    customer: null,
    picker: null,
    checker: null,
    ...overrides,
  };
}

describe('mergePublicOrderRows', () => {
  it('returns null for an empty array', () => {
    expect(mergePublicOrderRows([])).toBeNull();
  });

  it('passes through a single order unchanged', () => {
    const merged = mergePublicOrderRows([
      makeRow({ order_number: '880848', pallets_qty: 2, total_units: 5 }),
    ]);
    expect(merged?.orderNumber).toBe('880848');
    expect(merged?.combinedNumbers).toEqual(['880848']);
    expect(merged?.palletsQty).toBe(2);
  });

  it('merges two sibling rows into one combined view, sorted desc numeric', () => {
    const merged = mergePublicOrderRows([
      makeRow({
        id: 'a',
        order_number: '880787',
        created_at: '2026-07-20T09:00:00Z',
        pallets_qty: 1,
        items: [{ sku: 'SKU-A', pickingQty: 3 }],
        pallet_photos: ['a1.webp'],
      }),
      makeRow({
        id: 'b',
        order_number: '880848',
        created_at: '2026-07-20T10:00:00Z',
        pallets_qty: 2,
        items: [{ sku: 'SKU-B', pickingQty: 4 }],
        pallet_photos: ['b1.webp'],
      }),
    ]);

    expect(merged?.orderNumber).toBe('880848 / 880787');
    expect(merged?.combinedNumbers).toEqual(['880848', '880787']);
    expect(merged?.palletsQty).toBe(3);
    expect(merged?.totalUnits).toBe(7);
    expect(merged?.palletPhotos).toEqual(['a1.webp', 'b1.webp']);
    expect(merged?.unitsByOrder).toEqual({ '880787': 3, '880848': 4 });
  });

  it('tags every item with its owning sub-order number', () => {
    const merged = mergePublicOrderRows([
      makeRow({ id: 'a', order_number: '880787', items: [{ sku: 'SKU-A', pickingQty: 1 }] }),
      makeRow({ id: 'b', order_number: '880848', items: [{ sku: 'SKU-B', pickingQty: 1 }] }),
    ]);
    const bySku = Object.fromEntries((merged?.items ?? []).map((i) => [i.sku, i.source_order]));
    expect(bySku['SKU-A']).toBe('880787');
    expect(bySku['SKU-B']).toBe('880848');
  });

  it('is_shipped is true only when every sibling is shipped', () => {
    const merged = mergePublicOrderRows([
      makeRow({ id: 'a', order_number: '880787', is_shipped: true }),
      makeRow({ id: 'b', order_number: '880848', is_shipped: false }),
    ]);
    expect(merged?.isShipped).toBe(false);
  });

  it('takes the customer from whichever sibling has one set', () => {
    const merged = mergePublicOrderRows([
      makeRow({ id: 'a', order_number: '880787', customer: null }),
      makeRow({
        id: 'b',
        order_number: '880848',
        customer: {
          id: 'c1',
          name: 'Acme',
          street: '1 Main St',
          city: 'Springfield',
          state: 'IL',
          zip_code: '62704',
          phone: null,
        },
      }),
    ]);
    expect(merged?.customer?.name).toBe('Acme');
  });
});
