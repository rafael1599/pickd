import { describe, expect, it } from 'vitest';
import {
  buildElectricCartons,
  electricCartonClipboard,
  formatCartonDims,
  formatLbs,
  shortElectricModel,
  totalElectricCartonUnits,
} from '../electricCartons';

const hudson = { sku: '03-3607GY', name: 'HUDSON E2 S/T 14 2026 THUNDER', units: 1 };
const defcon = { sku: '03-4611BK', name: 'DEFCON E2 17', units: 2 };
const measured = {
  weight_lbs: 80,
  length_in: 56.3,
  width_in: 9.8,
  height_in: 37,
  dimensions_verified: true,
  model: 'HUDSON E2 S/T',
};

describe('shortElectricModel — what the station calls the bike', () => {
  it('stops at the generation token, from the catalog model first', () => {
    expect(shortElectricModel('HUDSON E2 S/T 14 2026 THUNDER', 'HUDSON E2 S/T', '03-3607GY')).toBe(
      'HUDSON E2'
    );
    expect(shortElectricModel(null, 'Hudson E1 Step-Over 18 Vanilla', '03-4869MN')).toBe(
      'HUDSON E1'
    );
    expect(shortElectricModel('DEFCON E2 17', null, '03-4611BK')).toBe('DEFCON E2');
  });

  it('never mistakes the Earth Cruiser (EC3) for a generation', () => {
    expect(shortElectricModel('EC3 18 TEAL FO REAL', null, '06-4470TL')).toBe('EC3 18');
  });

  it('falls back to two words, then the SKU', () => {
    expect(shortElectricModel('SOME NEW BIKE 2027', null, '03-9999XX')).toBe('SOME NEW');
    expect(shortElectricModel(null, null, '03-9999XX')).toBe('03-9999XX');
  });
});

describe('buildElectricCartons — figures, not a sentence', () => {
  it('takes weight, model and a measured carton from the catalog', () => {
    const [c] = buildElectricCartons([hudson], () => measured);
    expect(c.model).toBe('HUDSON E2');
    expect(c.weightLbs).toBe(80);
    expect(c.dims).toEqual({ length: 56.3, height: 37, width: 9.8 });
    expect(formatCartonDims(c.dims!)).toBe('57×37×10');
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
    expect(c.weightLbs).toBeNull();
  });

  it('no catalog row at all still yields a carton to declare', () => {
    const [c] = buildElectricCartons([{ ...hudson, name: null }], () => undefined);
    expect(c).toEqual({
      sku: '03-3607GY',
      name: null,
      model: '03-3607GY',
      units: 1,
      weightLbs: null,
      dims: null,
    });
  });

  it('units add up across cartons', () => {
    expect(totalElectricCartonUnits(buildElectricCartons([hudson, defcon], () => undefined))).toBe(
      3
    );
  });
});

describe('the copy button — exactly what Rafael wrote', () => {
  it('regular order: carton, bike, weight — no size', () => {
    const [c] = buildElectricCartons([hudson], () => ({ ...measured, weight_lbs: 78.6 }));
    expect(electricCartonClipboard(c, false)).toBe('1 carton, 1 HUDSON E2, 78.6 lbs');
  });

  it('FedEx order: the same, plus the carton in whole inches', () => {
    const [c] = buildElectricCartons([hudson], () => measured);
    expect(electricCartonClipboard(c, true)).toBe('1 carton, 1 HUDSON E2, 80 lbs, 57×37×10 in');
  });

  it('two of the same bike: two cartons, weight each; gaps are marked', () => {
    const [c] = buildElectricCartons([defcon], () => ({ weight_lbs: 54.23, model: 'DEFCON E2' }));
    expect(electricCartonClipboard(c, true)).toBe('2 cartons, 2 DEFCON E2, 54.2 lbs each, size ?');
    const [n] = buildElectricCartons([{ ...hudson, name: null }], () => undefined);
    expect(electricCartonClipboard(n, false)).toBe('1 carton, 1 03-3607GY, weight ?');
  });

  it('formatLbs keeps one decimal only when there is one', () => {
    expect(formatLbs(80)).toBe('80');
    expect(formatLbs(78.6)).toBe('78.6');
    expect(formatLbs(54.23)).toBe('54.2');
  });
});
