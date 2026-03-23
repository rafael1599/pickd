import { describe, it, expect } from 'vitest';
import {
  validateCapacityChange,
  hasActiveInventory,
  calculateLocationChangeImpact,
} from '../locationValidations';
import type { InventoryItem } from '../../schemas/inventory.schema';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const makeInventory = (overrides: Partial<InventoryItem> = {}): InventoryItem =>
  ({
    id: 1,
    sku: 'SKU-A',
    warehouse: 'LUDLOW',
    location: 'ROW-1',
    quantity: 5,
    is_active: true,
    created_at: new Date(),
    ...overrides,
  }) as InventoryItem;

// ---------------------------------------------------------------------------
// validateCapacityChange
// ---------------------------------------------------------------------------
describe('validateCapacityChange', () => {
  it('accepts valid capacity with no warnings', () => {
    const result = validateCapacityChange(100, []);
    expect(result.isValid).toBe(true);
    expect(result.errors).toHaveLength(0);
    expect(result.warnings).toHaveLength(0);
  });

  it('rejects capacity < 1', () => {
    const result = validateCapacityChange(0, []);
    expect(result.isValid).toBe(false);
    expect(result.errors).toContain('Capacity must be at least 1 unit');
  });

  it('rejects capacity > 10000', () => {
    const result = validateCapacityChange(10001, []);
    expect(result.isValid).toBe(false);
    expect(result.errors).toContain('Maximum capacity allowed is 10,000 units');
  });

  it('warns when capacity < current inventory total', () => {
    const inventory = [makeInventory({ quantity: 20 }), makeInventory({ id: 2, quantity: 10 })];
    const result = validateCapacityChange(25, inventory, 50);

    expect(result.isValid).toBe(true);
    expect(result.warnings.some((w) => w.type === 'CAPACITY_OVERFLOW')).toBe(true);
    expect(result.canProceedWithOverride).toBe(true);
  });

  it('warns on drastic capacity change (>50%)', () => {
    const result = validateCapacityChange(200, [], 50);

    expect(result.warnings.some((w) => w.type === 'DRASTIC_CHANGE')).toBe(true);
  });

  it('does NOT warn when capacity has not changed', () => {
    const inventory = [makeInventory({ quantity: 100 })];
    const result = validateCapacityChange(50, inventory, 50);

    // Even though 50 < 100 inventory, capacity didn't change so no warnings
    expect(result.warnings).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// hasActiveInventory
// ---------------------------------------------------------------------------
describe('hasActiveInventory', () => {
  it('returns true when location has items with quantity > 0', () => {
    const inventory = [makeInventory({ warehouse: 'LUDLOW', location: 'ROW-1', quantity: 5 })];
    expect(hasActiveInventory('LUDLOW', 'ROW-1', inventory)).toBe(true);
  });

  it('returns false when location has zero quantity', () => {
    const inventory = [makeInventory({ warehouse: 'LUDLOW', location: 'ROW-1', quantity: 0 })];
    expect(hasActiveInventory('LUDLOW', 'ROW-1', inventory)).toBe(false);
  });

  it('returns false for different warehouse', () => {
    const inventory = [makeInventory({ warehouse: 'ATS', location: 'ROW-1', quantity: 5 })];
    expect(hasActiveInventory('LUDLOW', 'ROW-1', inventory)).toBe(false);
  });

  it('returns false for empty inventory', () => {
    expect(hasActiveInventory('LUDLOW', 'ROW-1', [])).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// calculateLocationChangeImpact
// ---------------------------------------------------------------------------
describe('calculateLocationChangeImpact', () => {
  it('reports affected SKUs and total units', () => {
    const inventory = [
      makeInventory({ sku: 'A', quantity: 10 }),
      makeInventory({ sku: 'B', quantity: 5, id: 2 }),
    ];

    const impact = calculateLocationChangeImpact('LUDLOW', 'ROW-1', { zone: 'FAST' }, inventory);

    expect(impact.affectedSKUs).toBe(2);
    expect(impact.totalUnits).toBe(15);
    expect(impact.skuList).toEqual(['A', 'B']);
  });

  it('adds ZONE_CHANGE impact when zone changes', () => {
    const impact = calculateLocationChangeImpact('LUDLOW', 'ROW-1', { zone: 'SLOW' }, [
      makeInventory(),
    ]);

    expect(impact.impacts.some((i) => i.type === 'ZONE_CHANGE')).toBe(true);
  });

  it('adds CAPACITY_CHANGE impact when max_capacity changes', () => {
    const impact = calculateLocationChangeImpact('LUDLOW', 'ROW-1', { max_capacity: 200 }, [
      makeInventory(),
    ]);

    expect(impact.impacts.some((i) => i.type === 'CAPACITY_CHANGE')).toBe(true);
  });

  it('adds ORDER_CHANGE impact when picking_order changes', () => {
    const impact = calculateLocationChangeImpact('LUDLOW', 'ROW-1', { picking_order: 5 }, [
      makeInventory(),
    ]);

    expect(impact.impacts.some((i) => i.type === 'ORDER_CHANGE')).toBe(true);
  });

  it('detects invalidated optimization reports', () => {
    const reports = [
      {
        id: 'report-1',
        report_date: '2026-03-20',
        suggestions: {
          items: [{ promote: { location: 'ROW-1' } }],
        },
      },
    ];

    const impact = calculateLocationChangeImpact(
      'LUDLOW',
      'ROW-1',
      { zone: 'FAST' },
      [makeInventory()],
      reports
    );

    expect(impact.impacts.some((i) => i.type === 'REPORTS_INVALIDATED')).toBe(true);
    expect(impact.impacts.find((i) => i.type === 'REPORTS_INVALIDATED')?.reportIds).toEqual([
      'report-1',
    ]);
  });

  it('returns no impacts for items in different locations', () => {
    const inventory = [makeInventory({ location: 'ROW-99' })];

    const impact = calculateLocationChangeImpact('LUDLOW', 'ROW-1', { zone: 'FAST' }, inventory);

    expect(impact.affectedSKUs).toBe(0);
    expect(impact.totalUnits).toBe(0);
  });
});
