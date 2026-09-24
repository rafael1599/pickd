import { describe, it, expect } from 'vitest';
import {
  calculateStrappedPallets,
  isContainerLocation,
  compareLocations,
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
