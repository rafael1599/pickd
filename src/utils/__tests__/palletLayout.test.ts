import { describe, expect, it } from 'vitest';
import {
  layoutPallet,
  describeLayout,
  estimateLayout,
  placeBoxes,
  LEVEL_WIDTH_MAX_IN,
} from '../palletLayout';
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
const TRAIL = box(54, 8, 30);
const KOMODO = box(53, 11, 32.5);
const DURANGO = box(60.5, 9, 31);
const TRIKE = box(45, 14, 27.5);

const meta: Record<string, PalletBoxMeta> = {
  CITIZEN,
  FAULTLINE,
  LASER,
  DEFCON,
  TRAIL,
  KOMODO,
  DURANGO,
  TRIKE,
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

  it('nada flota: cada caja descansa en la madera o encima de otra (Rafael, 29 sep 2026)', () => {
    const l = layoutPallet(
      [
        { sku: 'DEFCON', pickingQty: 1 },
        { sku: 'FAULTLINE', pickingQty: 1 },
        { sku: 'TRAIL', pickingQty: 1 },
        { sku: 'LASER', pickingQty: 7 },
      ],
      metaFor,
      (sku) => sku === 'LASER'
    )!;
    for (const p of l.placements) {
      if (p.y <= 5 + 1e-6) continue;
      const below = l.placements.filter(
        (q) => q !== p && q.x < p.x + p.w - 1e-6 && q.x + q.w > p.x + 1e-6 && q.order < p.order
      );
      expect(below.some((q) => Math.abs(q.top - p.y) < 1e-6)).toBe(true);
    }
  });

  it('la 4.ª de #881774/#881761: LASER en columna junto a las grandes, 71" como la cinta', () => {
    const l = layoutPallet(
      [
        { sku: 'DEFCON', pickingQty: 1 },
        { sku: 'FAULTLINE', pickingQty: 1 },
        { sku: 'TRAIL', pickingQty: 1 },
        { sku: 'LASER', pickingQty: 7 },
      ],
      metaFor,
      (sku) => sku === 'LASER'
    )!;
    expect(l.height).toBeCloseTo(71, 0);
    expect(l.placements.filter((p) => p.level === 0)).toHaveLength(4);
    const laserOnLaser = l.placements.some(
      (p) =>
        p.box.sku === 'LASER' &&
        l.placements.some(
          (q) => q.box.sku === 'LASER' && q.order < p.order && Math.abs(q.top - p.y) < 1e-6
        )
    );
    expect(laserOnLaser).toBe(true);
  });

  it('una caja mal apoyada se ladea, y eso suma alto', () => {
    const l = layoutPallet(
      [
        { sku: 'DEFCON', pickingQty: 1 },
        { sku: 'FAULTLINE', pickingQty: 1 },
        { sku: 'TRAIL', pickingQty: 1 },
        { sku: 'LASER', pickingQty: 7 },
      ],
      metaFor,
      (sku) => sku === 'LASER'
    )!;
    const tilted = l.placements.filter((p) => Math.abs(p.tilt) > 1e-6);
    for (const p of tilted) {
      expect(Math.abs(p.tilt)).toBeLessThanOrEqual((7 * Math.PI) / 180 + 1e-9);
      // Girada sobre el borde del apoyo: su punta más alta queda, como poco, a su alto por el coseno.
      expect(p.top).toBeGreaterThanOrEqual(p.y + p.h * Math.cos(p.tilt) - 1e-6);
      expect(p.flat).toBe(false);
    }
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

describe('placeBoxes', () => {
  it('las cajas llegan justo al alto calculado y quedan centradas', () => {
    const l = layoutPallet([{ sku: 'CITIZEN', pickingQty: 10 }], metaFor)!;
    const placed = placeBoxes(l);
    expect(placed).toHaveLength(10);
    const top = Math.max(...placed.map((p) => p.y + p.sy / 2));
    expect(top).toBeCloseTo(l.height);
    const bottomLevel = placed.filter((p) => p.level === 0);
    const left = Math.min(...bottomLevel.map((p) => p.x - p.sx / 2));
    const right = Math.max(...bottomLevel.map((p) => p.x + p.sx / 2));
    expect(left).toBeCloseTo(-right);
    expect(placed.filter((p) => p.level === null)).toHaveLength(2);
    expect(placed.map((p) => p.order)).toEqual([...placed.keys()]);
  });

  it('ninguna caja se cruza con otra', () => {
    const l = layoutPallet(
      [
        { sku: 'LASER', pickingQty: 7 },
        { sku: 'DEFCON', pickingQty: 1 },
        { sku: 'CITIZEN', pickingQty: 2 },
      ],
      metaFor,
      (sku) => sku === 'LASER'
    )!;
    const p = placeBoxes(l);
    const overlap = (a: (typeof p)[number], b: (typeof p)[number]) =>
      (['x', 'y', 'z'] as const).every((axis) => {
        const size = { x: 'sx', y: 'sy', z: 'sz' } as const;
        return Math.abs(a[axis] - b[axis]) < (a[size[axis]] + b[size[axis]]) / 2 - 1e-6;
      });
    // Entre cajas derechas (una ladeada se apoya en el borde de otra y su caja envolvente no sirve).
    const straight = p.filter((b) => b.tilt === 0);
    for (let i = 0; i < straight.length; i += 1)
      for (let j = i + 1; j < straight.length; j += 1)
        expect(overlap(straight[i], straight[j])).toBe(false);
  });
});

describe('reglas del piso (Rafael, 29 sep 2026)', () => {
  it('el frente queda parejo: todas las puntas en el mismo plano', () => {
    const l = layoutPallet(
      [
        { sku: 'DEFCON', pickingQty: 1 },
        { sku: 'TRAIL', pickingQty: 1 },
        { sku: 'LASER', pickingQty: 7 },
      ],
      metaFor,
      (sku) => sku === 'LASER'
    )!;
    const fronts = placeBoxes(l).map((b) => b.z + b.sz / 2);
    for (const f of fronts) expect(f).toBeCloseTo(fronts[0]);
  });

  it('de pie en el hueco antes que acostar una caja gruesa: el triciclo no va encima (#881761, tarima 2)', () => {
    const l = layoutPallet(
      [
        { sku: 'KOMODO', pickingQty: 2 },
        { sku: 'DURANGO', pickingQty: 2 },
        { sku: 'CITIZEN', pickingQty: 4 },
        { sku: 'TRIKE', pickingQty: 1 },
      ],
      metaFor
    )!;
    const trike = l.placements.find((p) => p.box.sku === 'TRIKE')!;
    expect(trike.flat).toBe(false);
    expect(l.flat.every((b) => b.width <= 9)).toBe(true);
    expect(l.height).toBeLessThanOrEqual(77 + 1e-6);
  });

  it('el conjunto va centrado en la madera y sobresale como mucho 3" por cada lado', () => {
    const l = layoutPallet(
      [
        { sku: 'KOMODO', pickingQty: 2 },
        { sku: 'DURANGO', pickingQty: 2 },
        { sku: 'CITIZEN', pickingQty: 4 },
        { sku: 'TRIKE', pickingQty: 1 },
      ],
      metaFor
    )!;
    const p = placeBoxes(l);
    const left = Math.min(...p.map((b) => b.x - b.sx / 2));
    const right = Math.max(...p.map((b) => b.x + b.sx / 2));
    expect(left + right).toBeCloseTo(0);
    expect(right).toBeLessThanOrEqual(20 + 3 + 1e-6);
  });
});
