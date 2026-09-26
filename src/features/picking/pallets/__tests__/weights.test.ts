import { describe, expect, it } from 'vitest';
import {
  DEFAULT_AVG_BIKE_LBS,
  DEFAULT_AVG_PART_LBS,
  effectiveCounts,
  effectiveWeight,
  totalWeight,
  unitAverages,
} from '../weights';

const line = (qty: number, weightLbs: number | null, isBike: boolean, isElectric = false) => ({
  pickingQty: qty,
  weightLbs,
  isBike,
  isElectric,
});

describe('unitAverages', () => {
  it('media por clase, y la e-bike cuenta aparte sin pesar', () => {
    expect(
      unitAverages([
        line(2, 40, true),
        line(1, 50, true),
        line(3, 2, false),
        line(1, 80, true, true),
      ])
    ).toEqual({
      bikeUnits: 3,
      electricUnits: 1,
      partUnits: 3,
      avgBikeWeight: 130 / 3,
      avgPartWeight: 2,
    });
  });

  it('sin bicis o sin partes usa los defaults de siempre (45 y 0,1)', () => {
    const a = unitAverages([]);
    expect(a.avgBikeWeight).toBe(DEFAULT_AVG_BIKE_LBS);
    expect(a.avgPartWeight).toBe(DEFAULT_AVG_PART_LBS);
  });

  it('un peso desconocido cuenta como 0', () => {
    expect(unitAverages([line(2, null, true)]).avgBikeWeight).toBe(0);
  });
});

describe('totalWeight', () => {
  const averages = unitAverages([line(10, 45, true), line(4, 1, false), line(1, 80, true, true)]);
  const base = { averages, hasLines: true, palletCount: 2, isFedex: false, useTyped: true };

  it('bicis y partes por su media, más 40 lb de madera por pallet', () => {
    expect(totalWeight({ ...base, typed: { bikes: '', parts: '' } })).toBe(450 + 4 + 80);
  });

  it('FedEx no lleva madera', () => {
    expect(totalWeight({ ...base, isFedex: true, typed: { bikes: '', parts: '' } })).toBe(454);
  });

  it('las bicis tecleadas descuentan las eléctricas', () => {
    // 11 tecleadas − 1 e-bike = 10 por 45
    expect(totalWeight({ ...base, typed: { bikes: '11', parts: '' } })).toBe(450 + 4 + 80);
  });

  it('con filtro de sub-orden ignora lo tecleado', () => {
    expect(totalWeight({ ...base, useTyped: false, typed: { bikes: '99', parts: '99' } })).toBe(
      534
    );
  });

  it('sin líneas, sólo la madera', () => {
    expect(totalWeight({ ...base, hasLines: false, typed: { bikes: '', parts: '' } })).toBe(80);
  });
});

describe('effectiveWeight y effectiveCounts', () => {
  it('lo tecleado manda si es un número válido', () => {
    expect(effectiveWeight('512.4', 500, true)).toBe(512);
    expect(effectiveWeight('', 500, true)).toBe(500);
    expect(effectiveWeight('abc', 500, true)).toBe(500);
    expect(effectiveWeight('-3', 500, true)).toBe(500);
    expect(effectiveWeight('512', 500, false)).toBe(500);
  });

  it('las bicis automáticas incluyen las e-bikes', () => {
    const a = unitAverages([line(10, 45, true), line(1, 80, true, true), line(4, 1, false)]);
    expect(effectiveCounts(a, { bikes: '', parts: '' }, true)).toEqual({
      autoBikeCount: 11,
      autoPartCount: 4,
      bikeCount: 11,
      partCount: 4,
    });
    expect(effectiveCounts(a, { bikes: '12', parts: '' }, true).bikeCount).toBe(12);
    expect(effectiveCounts(a, { bikes: '12', parts: '' }, false).bikeCount).toBe(11);
  });
});
