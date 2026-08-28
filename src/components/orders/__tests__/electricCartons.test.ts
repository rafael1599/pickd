import { describe, expect, it } from 'vitest';
import {
  buildElectricCartons,
  electricCartonClipboard,
  electricCartonParts,
  totalElectricCartonUnits,
} from '../electricCartons';

const hudson = { sku: '03-3607GY', name: 'HUDSON E2 S/T 14 2026 THUNDER', units: 1 };
const defcon = { sku: '03-4611BK', name: 'DEFCON E2 17', units: 2 };

describe('buildElectricCartons — the e-bike as Audit Source wants it', () => {
  it('takes weight and a measured carton from the catalog', () => {
    const [c] = buildElectricCartons([hudson], () => ({
      weight_lbs: 80,
      length_in: 55,
      width_in: 8,
      height_in: 30,
      dimensions_verified: true,
    }));
    expect(c.weightLbs).toBe(80);
    expect(c.dims).toEqual({ length: 55, height: 30, width: 8 });
    expect(electricCartonParts(c)).toEqual({
      what: '1 × HUDSON E2 S/T 14 2026 THUNDER',
      weight: '80 lb',
      dims: '55×30×8 in',
    });
  });

  it('a default carton is not a size, and a missing weight stays missing', () => {
    const [c] = buildElectricCartons([defcon], () => ({
      weight_lbs: null,
      length_in: 55,
      width_in: 8.5,
      height_in: 30.5,
      dimensions_verified: false,
    }));
    expect(c.dims).toBeNull();
    expect(electricCartonParts(c)).toEqual({ what: '2 × DEFCON E2 17', weight: null, dims: null });
    expect(electricCartonClipboard(c)).toBe(
      'E-BIKE (lithium battery) — separate carton: DEFCON E2 17 03-4611BK × 2, weight ?, size ?'
    );
  });

  it('no catalog row at all still yields a carton to declare', () => {
    const [c] = buildElectricCartons([{ ...hudson, name: null }], () => undefined);
    expect(c).toEqual({ sku: '03-3607GY', name: null, units: 1, weightLbs: null, dims: null });
    expect(electricCartonParts(c).what).toBe('1 × 03-3607GY');
  });

  it('the clipboard line carries everything Audit Source could ask', () => {
    const [c] = buildElectricCartons([hudson], () => ({
      weight_lbs: 80,
      length_in: 55,
      width_in: 8,
      height_in: 30,
      dimensions_verified: true,
    }));
    expect(electricCartonClipboard(c)).toBe(
      'E-BIKE (lithium battery) — separate carton: HUDSON E2 S/T 14 2026 THUNDER 03-3607GY × 1, 80 lb each, 55×30×8 in'
    );
  });

  it('units add up across cartons', () => {
    expect(totalElectricCartonUnits(buildElectricCartons([hudson, defcon], () => undefined))).toBe(
      3
    );
  });
});
