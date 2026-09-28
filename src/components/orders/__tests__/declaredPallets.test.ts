import { describe, it, expect } from 'vitest';
import {
  allSameSize,
  buildPalletDeclaration,
  palletClipboard,
  partsBalance,
  splitLines,
  type PalletForDeclaration,
} from '../declaredPallets';
import type { PalletBoxMeta, PalletDimsEntry } from '../../../utils/palletDims';
import { planPallets } from '../../../features/picking/pallets/planPallets';

const BIKE: PalletBoxMeta = {
  length_in: 55,
  width_in: 8.5,
  height_in: 30.5,
  weight_lbs: 45,
  dimensions_verified: true,
};
const pallet = (id: number, qty: number, over: Partial<PalletForDeclaration> = {}) =>
  ({ id, items: [{ sku: '03-0001BK', pickingQty: qty }], ...over }) as PalletForDeclaration;

describe('buildPalletDeclaration', () => {
  it('declara cada pallet físico con su bulto y su peso', () => {
    const [d] = buildPalletDeclaration([pallet(1, 12)], [], () => BIKE);
    expect(d).toMatchObject({ pallet: 1, boxes: 12, weightLbs: 580, unmeasured: 0 });
    expect(d.size).toMatchObject({ length: 55, width: 43.5, height: 83, source: 'computed' });
  });

  it('lo tecleado pisa a lo calculado', () => {
    const entry: PalletDimsEntry = {
      pallet: 1,
      length_in: 56,
      width_in: 44,
      height_in: 79,
      units: 12,
    };
    const [d] = buildPalletDeclaration([pallet(1, 12)], [entry], () => BIKE);
    expect(d.size).toMatchObject({ length: 56, width: 44, height: 79, source: 'manual' });
  });

  it('el contenedor de partes no es un bulto', () => {
    const containers = [pallet(1, 12), pallet(2, 3, { isParts: true })];
    expect(buildPalletDeclaration(containers, [], () => BIKE)).toHaveLength(1);
  });

  it('cuenta las cajas sin medir para poder decirlo', () => {
    const [d] = buildPalletDeclaration([pallet(1, 4)], [], () => ({}));
    expect(d.unmeasured).toBe(4);
  });
});

describe('palletClipboard — lo que se pega en el portal', () => {
  it('pallets iguales se dicen en una línea', () => {
    const declared = buildPalletDeclaration([pallet(1, 12), pallet(2, 12)], [], () => BIKE);
    expect(allSameSize(declared)).toBe(true);
    expect(palletClipboard(declared)).toBe('2 pallets, 55x44x83 in, 580 lbs each, 1160 lbs total');
  });

  it('pallets distintos, uno por línea', () => {
    const declared = buildPalletDeclaration([pallet(1, 12), pallet(2, 4)], [], () => BIKE);
    expect(allSameSize(declared)).toBe(false);
    expect(palletClipboard(declared)).toBe(
      'pallet 1, 55x44x83 in, 580 lbs\npallet 2, 55x40x36 in, 220 lbs'
    );
  });

  it('uno solo lo dice en singular', () => {
    expect(palletClipboard(buildPalletDeclaration([pallet(1, 8)], [], () => BIKE))).toBe(
      '1 pallet, 55x40x66 in, 400 lbs'
    );
  });

  it('sin pallets no hay nada que copiar', () => {
    expect(palletClipboard([])).toBe('');
  });
});

describe('las partes viajan encima de un bulto (22 sep 2026)', () => {
  const partsBox = (id: number, qty: number) =>
    ({
      id,
      isParts: true,
      containerKind: 'parts',
      items: [{ sku: '71-0380', pickingQty: qty }],
    }) as PalletForDeclaration;
  // Dos libras por unidad de parte: la media que calcula Ship para esta orden.
  const ctx = (over = {}) => ({ partUnits: 6, partUnitWeight: 2, ...over });

  it('lo que nadie reparte viaja en el último bulto, y pesa allí', () => {
    const d = buildPalletDeclaration(
      [pallet(1, 12), pallet(2, 4), partsBox(3, 6)],
      [],
      () => BIKE,
      ctx()
    );
    expect(d).toHaveLength(2);
    expect(d[0]).toMatchObject({ parts: 0, partsTyped: false, weightLbs: 580 });
    // 4 × 45 + 40 de tarima + 6 partes × 2 lb
    expect(d[1]).toMatchObject({ parts: 6, partsTyped: false, weightLbs: 232 });
  });

  it('el peso de las partes deja de perderse: Σ(filas) cuadra con el total', () => {
    const d = buildPalletDeclaration([pallet(1, 10), partsBox(2, 6)], [], () => BIKE, ctx());
    // 10 bicis × 45 + 40 + 12 de partes = 502, que es lo que suma el WEIGHT de
    // arriba con la misma media. Antes la fila decía 490 y faltaban 12.
    expect(d[0].weightLbs).toBe(502);
  });

  it('lo tecleado manda y el resto sigue al último', () => {
    const d = buildPalletDeclaration(
      [pallet(1, 12), pallet(2, 4), partsBox(3, 6)],
      [{ pallet: 1, length_in: null, width_in: null, height_in: null, units: 12, parts: 2 }],
      () => BIKE,
      ctx()
    );
    expect(d[0]).toMatchObject({ parts: 2, partsTyped: true });
    expect(d[1]).toMatchObject({ parts: 4, partsTyped: false });
    expect(partsBalance(d, 6)).toBe(0);
  });

  it('teclear las dos filas y quedarse corto no se corrige solo: se avisa', () => {
    const entries = [
      { pallet: 1, length_in: null, width_in: null, height_in: null, units: 12, parts: 2 },
      { pallet: 2, length_in: null, width_in: null, height_in: null, units: 4, parts: 2 },
    ];
    const d = buildPalletDeclaration(
      [pallet(1, 12), pallet(2, 4), partsBox(3, 6)],
      entries,
      () => BIKE,
      ctx()
    );
    expect(partsBalance(d, 6)).toBe(2);
  });

  it('el bulto de las de niño no recibe lo que nadie repartió', () => {
    const kidsBox = {
      id: 2,
      containerKind: 'smallBikes',
      items: [{ sku: '07-3742BK', pickingQty: 12 }],
    } as PalletForDeclaration;
    const d = buildPalletDeclaration(
      [pallet(1, 10), kidsBox, partsBox(3, 6)],
      [],
      () => BIKE,
      ctx()
    );
    expect(d[0]).toMatchObject({ pallet: 1, parts: 6 });
    expect(d[1]).toMatchObject({ isKids: true, parts: 0 });
  });
});

describe('una carga sin una sola bici también sale en tarimas', () => {
  const partsBox = {
    id: 1,
    isParts: true,
    containerKind: 'parts',
    items: [{ sku: '71-0380', pickingQty: 13 }],
  } as PalletForDeclaration;

  it('las filas salen de lo que tecleó la estación', () => {
    const d = buildPalletDeclaration([partsBox], [], () => BIKE, {
      partUnits: 13,
      partUnitWeight: 3,
      palletsQty: 2,
    });
    expect(d).toHaveLength(2);
    expect(d[0]).toMatchObject({ pallet: 1, bikes: 0, boxes: 0, parts: 0, weightLbs: 40 });
    expect(d[1]).toMatchObject({ pallet: 2, parts: 13, weightLbs: 79 });
    // Nadie ha medido nada: las tres casillas nacen vacías.
    expect(d[0].size).toBeNull();
  });

  it('sin número tecleado se declara una', () => {
    const d = buildPalletDeclaration([partsBox], [], () => BIKE, {
      partUnits: 13,
      partUnitWeight: 3,
    });
    expect(d).toHaveLength(1);
    expect(d[0].parts).toBe(13);
  });

  it('y sin partes ni bicis no hay nada que declarar', () => {
    expect(buildPalletDeclaration([], [], () => BIKE, { palletsQty: 2 })).toHaveLength(0);
  });
});

describe('splitLines', () => {
  it('reparte parejo y en orden, partiendo una línea si hace falta', () => {
    const out = splitLines(
      [
        { sku: 'A', pickingQty: 10 },
        { sku: 'B', pickingQty: 15 },
      ],
      2
    );
    expect(out.map((r) => r.reduce((s, l) => s + l.pickingQty, 0))).toEqual([13, 12]);
    expect(out[0]).toEqual([
      { sku: 'A', pickingQty: 10 },
      { sku: 'B', pickingQty: 3 },
    ]);
    expect(out[1]).toEqual([{ sku: 'B', pickingQty: 12 }]);
  });

  it('lo dicho por tarima manda; lo que falta se reparte parejo entre las demás', () => {
    const lines = [
      { sku: 'A', pickingQty: 10 },
      { sku: 'B', pickingQty: 15 },
    ];
    const sums = (out: { pickingQty: number }[][]) =>
      out.map((r) => r.reduce((s, l) => s + l.pickingQty, 0));
    expect(splitLines(lines, 2, [10, 15]).map((r) => r.map((l) => l.sku))).toEqual([['A'], ['B']]);
    expect(sums(splitLines(lines, 2, [10]))).toEqual([10, 15]);
    expect(sums(splitLines(lines, 3, [5]))).toEqual([5, 10, 10]);
    // Lo dicho no suma el total y no queda a quién darle el resto: parejo.
    expect(sums(splitLines(lines, 2, [10, 10]))).toEqual([13, 12]);
    expect(sums(splitLines(lines, 2, [30]))).toEqual([13, 12]);
  });

  it('nunca más tarimas que cajas', () => {
    expect(splitLines([{ sku: 'A', pickingQty: 2 }], 5)).toHaveLength(2);
  });
});

/**
 * El camino real: el motor decide las tarimas (con lo que dijo el piso) y la
 * declaración sólo las mide y las pesa. Double Check pinta lo mismo.
 */
describe('motor + declaración — lo que ve Double Check es lo que declara Ship', () => {
  const CAPRI = '07-3690BL';
  const LASER = '07-3744BL';
  const META: Record<string, PalletBoxMeta> = {
    '03-0001BK': BIKE,
    [CAPRI]: {
      length_in: 48,
      width_in: 9,
      height_in: 26,
      weight_lbs: 38.6,
      dimensions_verified: true,
    },
    [LASER]: {
      length_in: 43,
      width_in: 8.5,
      height_in: 22,
      weight_lbs: 32.19,
      dimensions_verified: true,
    },
  };
  const metaFor = (sku: string) => META[sku];
  const orden = [
    { sku: '03-0001BK', location: 'ROW 1', pickingQty: 12 },
    { sku: CAPRI, location: 'ROW 42', pickingQty: 10 },
    { sku: LASER, location: 'ROW 42', pickingQty: 15 },
  ];
  const sets = { bikes: new Set(orden.map((l) => l.sku)), smallBikes: new Set([CAPRI, LASER]) };
  const entry = (pallet: number, over: Partial<PalletDimsEntry>): PalletDimsEntry => ({
    pallet,
    length_in: null,
    width_in: null,
    height_in: null,
    units: 0,
    ...over,
  });
  const declare = (floor: PalletDimsEntry[] = []) =>
    buildPalletDeclaration(
      planPallets(orden, sets, { floor, metaFor }).map((p) => ({
        id: p.id,
        isParts: p.isParts,
        containerKind: p.containerKind,
        kidsOf: p.kidsOf,
        kidsSplit: p.kidsSplit,
        items: p.items.map((i) => ({ sku: i.sku, pickingQty: i.pickingQty })),
      })),
      floor,
      metaFor
    );

  it('#881677: 12 grandes + 10 Capri + 15 Laser, con sus altos', () => {
    const d = declare();
    expect(
      d.map((p) => [p.pallet, p.isKids, p.bikes, p.size && Math.round(p.size.height)])
    ).toEqual([
      [1, false, 12, 83],
      [2, true, 10, 57],
      [3, true, 15, 71],
    ]);
    expect(Math.round(d[1].weightLbs)).toBe(426);
    expect(Math.round(d[2].weightLbs)).toBe(523);
  });

  it('medido a mano en una tarima de niño manda sobre lo calculado', () => {
    const d = declare([entry(3, { length_in: 53, width_in: 43, height_in: 70, units: 15 })]);
    expect(d[2].size).toMatchObject({
      length: 53,
      width: 43,
      height: 70,
      source: 'manual',
      stale: false,
    });
  });

  it('el «+/–» y las bicis tecleadas por tarima de niño mandan', () => {
    const d = declare([entry(2, { split: 2, bikes: 13 })]);
    expect(d.slice(1).map((p) => [p.bikes, p.bikesTyped])).toEqual([
      [13, true],
      [12, false],
    ]);
  });

  it('una tarima armada a mano sale como fila propia y el total no cambia', () => {
    const d = declare([entry(9, { items: [{ sku: LASER, qty: 5 }] })]);
    expect(d.reduce((sum, p) => sum + p.bikes, 0)).toBe(37);
    expect(d.find((p) => p.pallet === 9)).toMatchObject({ bikes: 5, isKids: true });
  });

  it('las bicis tecleadas en una grande reacomodan las demás grandes', () => {
    const d = buildPalletDeclaration(
      planPallets(
        [{ sku: '03-0001BK', location: 'ROW 1', pickingQty: 31 }],
        { bikes: new Set(['03-0001BK']), smallBikes: new Set() },
        { floor: [entry(1, { bikes: 11 }), entry(2, { bikes: 10 })], metaFor }
      ).map((p) => ({ id: p.id, items: p.items })),
      [entry(1, { bikes: 11 }), entry(2, { bikes: 10 })],
      metaFor
    );
    expect(d.map((p) => [p.bikes, p.bikesTyped])).toEqual([
      [11, true],
      [10, true],
      [10, false],
    ]);
  });
});
