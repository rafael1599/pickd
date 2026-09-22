import { describe, it, expect } from 'vitest';
import {
  calculateStrappedPallets,
  isContainerLocation,
  compareLocations,
  buildSkuPalletDistribution,
  type InventorySourceRow,
} from '../strappedPalletDistribution';

describe('calculateStrappedPallets', () => {
  it('returns 0 for 0 or negative quantities', () => {
    expect(calculateStrappedPallets(0)).toBe(0);
    expect(calculateStrappedPallets(-5)).toBe(0);
  });

  it('calculates exact multiples of 12 correctly', () => {
    expect(calculateStrappedPallets(12)).toBe(1);
    expect(calculateStrappedPallets(24)).toBe(2);
    expect(calculateStrappedPallets(36)).toBe(3);
    expect(calculateStrappedPallets(120)).toBe(10);
  });

  it('rounds up for partial strapped pallets', () => {
    expect(calculateStrappedPallets(1)).toBe(1);
    expect(calculateStrappedPallets(11)).toBe(1);
    expect(calculateStrappedPallets(13)).toBe(2);
    expect(calculateStrappedPallets(25)).toBe(3);
    expect(calculateStrappedPallets(37)).toBe(4);
  });
});

describe('isContainerLocation', () => {
  it('identifies 4-digit + N container names', () => {
    expect(isContainerLocation('7004N')).toBe(true);
    expect(isContainerLocation('6430n')).toBe(true);
    expect(isContainerLocation('9000N')).toBe(true);
  });

  it('rejects regular warehouse rows and other areas', () => {
    expect(isContainerLocation('ROW 12')).toBe(false);
    expect(isContainerLocation('ROW 4')).toBe(false);
    expect(isContainerLocation('BAY 1')).toBe(false);
    expect(isContainerLocation('RETURN TO STOCK')).toBe(false);
    expect(isContainerLocation('CAGE 1')).toBe(false);
    expect(isContainerLocation(null)).toBe(false);
    expect(isContainerLocation('')).toBe(false);
  });
});

describe('compareLocations', () => {
  it('orders ROW numbers numerically', () => {
    const rows = ['ROW 12', 'ROW 2', 'ROW 1', 'ROW 20', 'ROW 10'];
    rows.sort(compareLocations);
    expect(rows).toEqual(['ROW 1', 'ROW 2', 'ROW 10', 'ROW 12', 'ROW 20']);
  });

  it('places ROW before non-ROW locations', () => {
    const list = ['CAGE 1', 'ROW 5', 'BAY 2'];
    list.sort(compareLocations);
    expect(list[0]).toBe('ROW 5');
  });
});

describe('buildSkuPalletDistribution', () => {
  it('aggregates warehouse locations and excludes container stock from ludlow count', () => {
    const items: InventorySourceRow[] = [
      {
        id: 1,
        sku: '03-3986TL',
        quantity: 10,
        location: 'ROW 12',
        sublocation: ['A'],
        warehouse: 'LUDLOW',
        item_name: 'FAULTLINE A1 V2 15 2026 GLOSS BLACK',
        sku_metadata: {
          sku: '03-3986TL',
          model: 'FAULTLINE A1 V2',
          size: '15',
          color: 'GLOSS BLACK',
          received_year: 2026,
          is_bike: true,
        },
      },
      {
        id: 2,
        sku: '03-3986TL',
        quantity: 14,
        location: 'ROW 14',
        sublocation: ['B'],
        warehouse: 'LUDLOW',
        item_name: 'FAULTLINE A1 V2 15 2026 GLOSS BLACK',
        sku_metadata: null,
      },
      {
        id: 3,
        sku: '03-3986TL',
        quantity: 24,
        location: '7004N', // container!
        sublocation: null,
        warehouse: 'LUDLOW',
        item_name: 'FAULTLINE A1 V2 15 2026 GLOSS BLACK',
        sku_metadata: null,
      },
    ];

    const [result] = buildSkuPalletDistribution(items);
    expect(result).toBeDefined();
    expect(result.sku).toBe('03-3986TL');
    // Ludlow warehouse quantity should be 10 + 14 = 24 (excluding the 24 in container 7004N)
    expect(result.ludlowQty).toBe(24);
    // Container quantity tracked separately
    expect(result.containerQty).toBe(24);
    expect(result.totalQty).toBe(48);
    // Dist strapped pallets should be Math.ceil(24 / 12) = 2
    expect(result.distPallets).toBe(2);
    // Warehouse locations
    expect(result.warehouseLocationsLabel).toContain('ROW 12 A (10)');
    expect(result.warehouseLocationsLabel).toContain('ROW 14 B (14)');
    expect(result.containerLocationsLabel).toContain('7004N (24)');
    // Size, color, year
    expect(result.size).toBe('15');
    expect(result.color).toBe('GLOSS BLACK');
    expect(result.year).toBe('2026');
  });

  it('falls back to parsing bike name if metadata is missing', () => {
    const items: InventorySourceRow[] = [
      {
        id: 10,
        sku: '02-1234BK',
        quantity: 13,
        location: 'ROW 5',
        sublocation: null,
        warehouse: 'LUDLOW',
        item_name: 'VENTURA A1 48 2025 MIDNIGHT BLUE',
        sku_metadata: null,
      },
    ];

    const [result] = buildSkuPalletDistribution(items);
    expect(result.size).toBe('48');
    expect(result.color).toBe('MIDNIGHT BLUE');
    expect(result.year).toBe('2025');
    expect(result.ludlowQty).toBe(13);
    // 13 bikes need 2 strapped pallets (12 + 1)
    expect(result.distPallets).toBe(2);
  });
});
