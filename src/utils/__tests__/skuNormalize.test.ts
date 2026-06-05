import { describe, it, expect } from 'vitest';
import { canonicalBikeSku } from '../skuNormalize';

describe('canonicalBikeSku', () => {
  it('strips a spurious extra trailing letter from a bike SKU', () => {
    expect(canonicalBikeSku('03-3768BLD')).toBe('03-3768BL');
    expect(canonicalBikeSku('03-3769BLD')).toBe('03-3769BL');
  });

  it('leaves a regular 2-letter bike SKU unchanged', () => {
    expect(canonicalBikeSku('03-3768BL')).toBe('03-3768BL');
    expect(canonicalBikeSku('06-4427RB')).toBe('06-4427RB');
  });

  it('strips multiple extra trailing letters down to the canonical 2', () => {
    expect(canonicalBikeSku('03-3768BLDX')).toBe('03-3768BL');
  });

  it('does not touch non-bike-pattern SKUs', () => {
    expect(canonicalBikeSku('128353')).toBe('128353');
    expect(canonicalBikeSku('700108')).toBe('700108');
    expect(canonicalBikeSku('860027BK')).toBe('860027BK');
    expect(canonicalBikeSku('992604')).toBe('992604');
  });

  it('handles null/empty safely', () => {
    expect(canonicalBikeSku(null)).toBe('');
    expect(canonicalBikeSku(undefined)).toBe('');
    expect(canonicalBikeSku('  ')).toBe('');
  });

  it('trims whitespace', () => {
    expect(canonicalBikeSku('  03-3768BLD ')).toBe('03-3768BL');
  });
});
