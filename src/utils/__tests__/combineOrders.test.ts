import { describe, expect, it } from 'vitest';
import { combineOrdersCore, type BaseOrderInput } from '../combineOrders';

describe('combineOrdersCore', () => {
  it('throws on empty array', () => {
    expect(() => combineOrdersCore([])).toThrow('Cannot combine empty order list');
  });

  it('handles a single order cleanly', () => {
    const order: BaseOrderInput = {
      id: 'ord-1',
      order_number: '880100',
      created_at: '2026-09-01T10:00:00Z',
      items: [{ sku: 'SKU-1', pickingQty: 5 }],
      pallets_qty: 1,
      total_units: 5,
    };
    const result = combineOrdersCore([order]);
    expect(result.anchor.id).toBe('ord-1');
    expect(result.combinedOrderNumber).toBe('880100');
    expect(result.combinedTotalUnits).toBe(5);
    expect(result.combinedPalletsQty).toBe(1);
    expect(result.combinedItems).toEqual([
      { sku: 'SKU-1', pickingQty: 5, source_order: '880100', source_list_id: 'ord-1' },
    ]);
  });

  it('deterministically selects oldest order by created_at as anchor regardless of input array order', () => {
    const oOld: BaseOrderInput = {
      id: 'id-old',
      order_number: '880001',
      created_at: '2026-09-01T08:00:00Z',
      pallets_qty: 1,
      items: [{ sku: 'SKU-A', pickingQty: 2 }],
    };
    const oNew: BaseOrderInput = {
      id: 'id-new',
      order_number: '880002',
      created_at: '2026-09-01T12:00:00Z',
      pallets_qty: 2,
      items: [{ sku: 'SKU-B', pickingQty: 3 }],
    };

    // Forward order
    const res1 = combineOrdersCore([oOld, oNew]);
    expect(res1.anchor.id).toBe('id-old');
    expect(res1.combinedOrderNumber).toBe('880002 / 880001'); // sorted desc numeric
    expect(res1.combinedTotalUnits).toBe(5);
    expect(res1.combinedPalletsQty).toBe(3);

    // Reverse order
    const res2 = combineOrdersCore([oNew, oOld]);
    expect(res2.anchor.id).toBe('id-old');
    expect(res2.combinedOrderNumber).toBe('880002 / 880001');
    expect(res2.combinedTotalUnits).toBe(5);
    expect(res2.combinedPalletsQty).toBe(3);
  });

  it('tags items with source_order and source_list_id', () => {
    const o1: BaseOrderInput = {
      id: 'id-1',
      order_number: '880010',
      created_at: '2026-09-01T10:00:00Z',
      items: [{ sku: 'SKU-A', pickingQty: 4 }],
    };
    const o2: BaseOrderInput = {
      id: 'id-2',
      order_number: '880020',
      created_at: '2026-09-01T11:00:00Z',
      items: [{ sku: 'SKU-B', pickingQty: 6 }],
    };

    const res = combineOrdersCore([o1, o2]);
    expect(res.combinedItems).toHaveLength(2);
    expect(res.combinedItems[0].source_order).toBe('880010');
    expect(res.combinedItems[0].source_list_id).toBe('id-1');
    expect(res.combinedItems[1].source_order).toBe('880020');
    expect(res.combinedItems[1].source_list_id).toBe('id-2');
    expect(res.unitsByOrder).toEqual({
      '880010': 4,
      '880020': 6,
    });
  });

  it('prioritizes physical facts from anchor.shipment when present', () => {
    const o1: BaseOrderInput = {
      id: 'id-1',
      order_number: '880010',
      created_at: '2026-09-01T10:00:00Z',
      pallets_qty: 99,
      load_number: 'OLD-LOAD',
      transport_company: 'OLD-TRUCK',
      is_shipped: false,
      shipment: {
        id: 'ship-1',
        pallets_qty: 4,
        load_number: 'SHIP-LOAD-77',
        transport_company: 'ESTES',
        total_weight_lbs: 850,
        pallet_photos: ['https://photo/1.jpg'],
        is_shipped: true,
      },
    };
    const o2: BaseOrderInput = {
      id: 'id-2',
      order_number: '880020',
      created_at: '2026-09-01T11:00:00Z',
      pallets_qty: 99,
      is_shipped: false,
    };

    const res = combineOrdersCore([o1, o2]);
    expect(res.combinedPalletsQty).toBe(4);
    expect(res.combinedLoadNumber).toBe('SHIP-LOAD-77');
    expect(res.combinedTransportCompany).toBe('ESTES');
    expect(res.combinedTotalWeightLbs).toBe(850);
    expect(res.combinedPalletPhotos).toEqual(['https://photo/1.jpg']);
    expect(res.combinedIsShipped).toBe(true);
  });
});
