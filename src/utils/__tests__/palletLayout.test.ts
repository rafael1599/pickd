import { describe, expect, it } from 'vitest';
import { layoutPallet, describeLayout, estimateLayout, LEVEL_WIDTH_MAX_IN } from '../palletLayout';
import type { PalletBoxMeta } from '../palletDims';

const box = (length: number, width: number, height: number): PalletBoxMeta => ({
  length_in: length,
  width_in: width,
  height_in: height,
  weight_lbs: 45,
  dimensions_verified: true,
});

const CITIZEN = box(55, 8.5, 30.5);
const FAULTLINE = box(53, 11, 32);
const LASER = box(43, 8.5, 22);
const DEFCON = box(55.75, 12, 34);

const meta: Record<string, PalletBoxMeta> = {
  CITIZEN,
  FAULTLINE,
  LASER,
  DEFCON,
};
const metaFor = (sku: string) => meta[sku];

describe('layoutPallet', () => {
  it('5 CITIZEN: 4 de canto y la 5.ª acostada, como el piso (#881741: 44"; la regla vieja, 66")', () => {
    const l = layoutPallet([{ sku: 'CITIZEN', pickingQty: 5 }], metaFor)!;
    expect(l.levels.map((lv) => lv.length)).toEqual([4]);
    expect(l.flat).toHaveLength(1);
    expect(l.height).toBe(44);
    expect(l.width).toBe(40);
  });

  it('10 grandes: 4 + 4 + 2 acostadas; 5 de canto sólo desde 11 (Rafael, 29 sep 2026)', () => {
    const ten = layoutPallet([{ sku: 'CITIZEN', pickingQty: 10 }], metaFor)!;
    expect(ten.levels.map((lv) => lv.length)).toEqual([4, 4]);
    expect(ten.flat).toHaveLength(2);
    const twelve = layoutPallet([{ sku: 'CITIZEN', pickingQty: 12 }], metaFor)!;
    expect(twelve.levels.map((lv) => lv.length)).toEqual([5, 5]);
    expect(twelve.flat).toHaveLength(2);
  });

  it('una capa sólo de niño lleva 5; un nivel mixto cuenta como de grandes', () => {
    const l = layoutPallet(
      [
        { sku: 'LASER', pickingQty: 7 },
        { sku: 'DEFCON', pickingQty: 1 },
        { sku: 'CITIZEN', pickingQty: 2 },
      ],
      metaFor,
      (sku) => sku === 'LASER'
    )!;
    expect(l.levels[0]).toHaveLength(4); // DEFCON + 2 CITIZEN + 1 LASER
    expect(l.levels[1].every((b) => b.sku === 'LASER')).toBe(true);
    expect(l.levels[1]).toHaveLength(5);
  });

  it('ningún nivel pasa del ancho máximo', () => {
    const l = layoutPallet([{ sku: 'FAULTLINE', pickingQty: 8 }], metaFor)!;
    for (const level of l.levels) {
      expect(level.reduce((s, b) => s + b.width, 0)).toBeLessThanOrEqual(LEVEL_WIDTH_MAX_IN);
    }
    expect(l.levels[0]).toHaveLength(4); // 4 × 11 = 44 cabe
    const wide = layoutPallet([{ sku: 'FAULTLINE', pickingQty: 12 }], metaFor)!;
    expect(wide.levels[0]).toHaveLength(4); // tope 5 en 12, pero 5 × 11 = 55 no cabe
  });

  it('las más altas van abajo', () => {
    const l = layoutPallet(
      [
        { sku: 'LASER', pickingQty: 7 },
        { sku: 'DEFCON', pickingQty: 1 },
      ],
      metaFor
    )!;
    expect(l.levels[0][0].sku).toBe('DEFCON');
  });

  it('nunca más de dos acostadas, nunca más de 90"', () => {
    const l = layoutPallet([{ sku: 'CITIZEN', pickingQty: 12 }], metaFor)!;
    expect(l.flat.length).toBeLessThanOrEqual(2);
    expect(l.height).toBeLessThanOrEqual(90);
    expect(l.overHeight).toBe(false);
  });

  it('describe la instrucción nivel por nivel', () => {
    const l = layoutPallet([{ sku: 'CITIZEN', pickingQty: 5 }], metaFor)!;
    expect(describeLayout(l)).toEqual({
      levels: [[{ sku: 'CITIZEN', qty: 4 }]],
      flat: [{ sku: 'CITIZEN', qty: 1 }],
    });
  });

  it('sin cajas no hay tarima', () => {
    expect(layoutPallet([], metaFor)).toBeNull();
  });
});

describe('estimateLayout', () => {
  it('la medida es la del armado, con la instrucción al lado', () => {
    const e = estimateLayout([{ sku: 'CITIZEN', pickingQty: 5 }], metaFor)!;
    expect([e.length, e.width, e.height]).toEqual([55, 40, 44]);
    expect(e.levels).toBe(1);
    expect(e.flat).toBe(1);
    expect(e.bikes).toBe(5);
    expect(e.weightLbs).toBe(5 * 45 + 40);
    expect(e.layout.levels[0]).toHaveLength(4);
  });
});
