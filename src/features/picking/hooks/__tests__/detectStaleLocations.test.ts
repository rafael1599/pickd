import { describe, it, expect } from 'vitest';
import { detectStaleLocations, type StaleInventoryRow } from '../useStaleLocationCheck';

const row = (
  sku: string,
  location: string | null,
  quantity: number,
  is_active = true,
  warehouse: string | null = 'LUDLOW'
): StaleInventoryRow => ({ sku, location, quantity, is_active, warehouse });

describe('detectStaleLocations', () => {
  it('flags an item whose frozen location is empty but has stock elsewhere', () => {
    const items = [{ sku: '03-4065BL', location: 'ROW 14', warehouse: 'LUDLOW' }];
    const rows = [row('03-4065BL', 'ROW 14', 0), row('03-4065BL', 'ROW 31', 53)];

    const result = detectStaleLocations(items, rows);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      sku: '03-4065BL',
      frozenLocation: 'ROW 14',
      suggestedLocation: 'ROW 31',
      suggestedQty: 53,
    });
  });

  it('does NOT flag when the frozen location still has stock', () => {
    const items = [{ sku: '06-4427RB', location: 'ROW 4', warehouse: 'LUDLOW' }];
    const rows = [row('06-4427RB', 'ROW 4', 10), row('06-4427RB', 'ROW 3', 5)];

    expect(detectStaleLocations(items, rows)).toHaveLength(0);
  });

  it('does NOT flag when the SKU is out of stock everywhere (genuine no-stock)', () => {
    const items = [{ sku: '128353', location: 'H13', warehouse: 'LUDLOW' }];
    const rows = [row('128353', 'H13', 0), row('128353', null, 0)];

    expect(detectStaleLocations(items, rows)).toHaveLength(0);
  });

  it('ignores inactive ghost rows when looking for stock elsewhere', () => {
    const items = [{ sku: '03-4065BL', location: 'ROW 14', warehouse: 'LUDLOW' }];
    // Only an inactive row has units → not a real suggestion → not stale.
    const rows = [row('03-4065BL', 'ROW 14', 0), row('03-4065BL', 'ROW 17', 7, false)];

    expect(detectStaleLocations(items, rows)).toHaveLength(0);
  });

  it('picks the location with the most stock as the suggestion', () => {
    const items = [{ sku: 'X', location: 'ROW 1', warehouse: 'LUDLOW' }];
    const rows = [
      row('X', 'ROW 1', 0),
      row('X', 'ROW 2', 3),
      row('X', 'ROW 9', 12),
      row('X', 'ROW 5', 8),
    ];

    expect(detectStaleLocations(items, rows)[0]).toMatchObject({
      suggestedLocation: 'ROW 9',
      suggestedQty: 12,
    });
  });

  it('matches location/warehouse case- and whitespace-insensitively', () => {
    const items = [{ sku: 'X', location: ' row 4 ', warehouse: 'ludlow' }];
    const rows = [row('X', 'ROW 4', 0), row('X', 'ROW 7', 4)];

    expect(detectStaleLocations(items, rows)).toHaveLength(1);
  });

  it('skips items without a frozen location or marked sku_not_found', () => {
    const items = [
      { sku: 'A', location: null, warehouse: 'LUDLOW' },
      { sku: 'B', location: 'ROW 1', warehouse: 'LUDLOW', sku_not_found: true },
    ];
    const rows = [row('A', 'ROW 9', 5), row('B', 'ROW 9', 5)];

    expect(detectStaleLocations(items, rows)).toHaveLength(0);
  });

  it('does not match stock from a different warehouse', () => {
    const items = [{ sku: 'X', location: 'ROW 1', warehouse: 'LUDLOW' }];
    const rows = [row('X', 'ROW 1', 0, true, 'LUDLOW'), row('X', 'ROW 2', 9, true, 'ATS')];

    expect(detectStaleLocations(items, rows)).toHaveLength(0);
  });
});
