import { describe, it, expect } from 'vitest';
import { detectCombineConflicts, type ConflictCheckOrder } from '../utils/combineConflicts';

describe('detectCombineConflicts', () => {
  it('detects no conflict when orders have identical addresses and no load numbers', () => {
    const orders: ConflictCheckOrder[] = [
      {
        order_number: '881001',
        ship_to_address_id: 'addr-1',
        ship_to: {
          id: 'addr-1',
          street: '123 Main St',
          city: 'Miami',
          state: 'FL',
          zip_code: '33101',
        },
      },
      {
        order_number: '881002',
        ship_to_address_id: 'addr-1',
        ship_to: {
          id: 'addr-1',
          street: '123 Main St',
          city: 'Miami',
          state: 'FL',
          zip_code: '33101',
        },
      },
    ];

    const result = detectCombineConflicts(orders);
    expect(result.hasConflict).toBe(false);
    expect(result.hasAddressConflict).toBe(false);
    expect(result.hasLoadNumberConflict).toBe(false);
    expect(result.defaultAddressId).toBe('addr-1');
  });

  it('detects address conflict when orders have different ship_to_address_id', () => {
    const orders: ConflictCheckOrder[] = [
      {
        order_number: '881001',
        ship_to_address_id: 'addr-1',
        ship_to: {
          id: 'addr-1',
          street: '123 Main St',
          city: 'Miami',
          state: 'FL',
          zip_code: '33101',
        },
      },
      {
        order_number: '881002',
        ship_to_address_id: 'addr-2',
        ship_to: {
          id: 'addr-2',
          street: '456 Ocean Dr',
          city: 'Tampa',
          state: 'FL',
          zip_code: '33601',
        },
      },
    ];

    const result = detectCombineConflicts(orders);
    expect(result.hasConflict).toBe(true);
    expect(result.hasAddressConflict).toBe(true);
    expect(result.hasLoadNumberConflict).toBe(false);
    expect(result.addressOptions).toHaveLength(2);
    expect(result.addressOptions[0].orderNumbers).toContain('881001');
    expect(result.addressOptions[1].orderNumbers).toContain('881002');
  });

  it('detects load number conflict when orders have different load numbers', () => {
    const orders: ConflictCheckOrder[] = [
      {
        order_number: '881001',
        load_number: 'LOAD-AAA',
      },
      {
        order_number: '881002',
        load_number: 'LOAD-BBB',
      },
    ];

    const result = detectCombineConflicts(orders);
    expect(result.hasConflict).toBe(true);
    expect(result.hasAddressConflict).toBe(false);
    expect(result.hasLoadNumberConflict).toBe(true);
    expect(result.loadOptions).toHaveLength(2);
    expect(result.loadOptions.map((o) => o.loadNumber)).toEqual(['LOAD-AAA', 'LOAD-BBB']);
  });

  it('prioritizes shipment properties over legacy order properties', () => {
    const orders: ConflictCheckOrder[] = [
      {
        order_number: '881001',
        ship_to_address_id: 'old-addr',
        load_number: 'OLD-LOAD',
        shipment: {
          ship_to_address_id: 'new-addr-1',
          load_number: 'NEW-LOAD-1',
        },
      },
      {
        order_number: '881002',
        ship_to_address_id: 'old-addr',
        load_number: 'OLD-LOAD',
        shipment: {
          ship_to_address_id: 'new-addr-2',
          load_number: 'NEW-LOAD-2',
        },
      },
    ];

    const result = detectCombineConflicts(orders);
    expect(result.hasAddressConflict).toBe(true);
    expect(result.hasLoadNumberConflict).toBe(true);
    expect(result.addressOptions.map((a) => a.addressId)).toEqual(['new-addr-1', 'new-addr-2']);
    expect(result.loadOptions.map((l) => l.loadNumber)).toEqual(['NEW-LOAD-1', 'NEW-LOAD-2']);
  });

  it('ignores null or empty load numbers when only one order has a load number', () => {
    const orders: ConflictCheckOrder[] = [
      {
        order_number: '881001',
        load_number: 'LOAD-ONLY-ONE',
      },
      {
        order_number: '881002',
        load_number: null,
      },
      {
        order_number: '881003',
        load_number: '   ',
      },
    ];

    const result = detectCombineConflicts(orders);
    expect(result.hasConflict).toBe(false);
    expect(result.hasLoadNumberConflict).toBe(false);
    expect(result.defaultLoadNumber).toBe('LOAD-ONLY-ONE');
  });
});
