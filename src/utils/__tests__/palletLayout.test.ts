import { describe, expect, it } from 'vitest';
import { layoutPallet, describeLayout, LEVEL_WIDTH_MAX_IN } from '../palletLayout';
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
  it('5 CITIZEN caben de canto en un solo nivel (la regla vieja abría un segundo: 66")', () => {
    const l = layoutPallet([{ sku: 'CITIZEN', pickingQty: 5 }], metaFor)!;
    expect(l.levels.map((lv) => lv.length)).toEqual([5]);
    expect(l.flat).toHaveLength(0);
    expect(l.height).toBe(35.5);
    expect(l.width).toBe(43.5); // 42.5 + abombado
  });

  it('ningún nivel pasa del ancho máximo', () => {
    const l = layoutPallet([{ sku: 'FAULTLINE', pickingQty: 8 }], metaFor)!;
    for (const level of l.levels) {
      expect(level.reduce((s, b) => s + b.width, 0)).toBeLessThanOrEqual(LEVEL_WIDTH_MAX_IN);
    }
    expect(l.levels[0]).toHaveLength(4); // 4 × 11 = 44; 5 × 11 = 55 no cabe
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
    expect(describeLayout(l)).toEqual({ levels: [[{ sku: 'CITIZEN', qty: 5 }]], flat: [] });
  });

  it('sin cajas no hay tarima', () => {
    expect(layoutPallet([], metaFor)).toBeNull();
  });
});
