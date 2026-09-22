import { describe, it, expect } from 'vitest';
import {
  allSameSize,
  buildPalletDeclaration,
  palletClipboard,
  partsBalance,
  type PalletForDeclaration,
} from '../declaredPallets';
import type { PalletBoxMeta, PalletDimsEntry } from '../../../utils/palletDims';

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
    expect(d.size).toMatchObject({ length: 55, width: 42.5, height: 83, source: 'computed' });
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
    expect(palletClipboard(declared)).toBe('2 pallets, 55x43x83 in, 580 lbs each, 1160 lbs total');
  });

  it('pallets distintos, uno por línea', () => {
    const declared = buildPalletDeclaration([pallet(1, 12), pallet(2, 4)], [], () => BIKE);
    expect(allSameSize(declared)).toBe(false);
    expect(palletClipboard(declared)).toBe(
      'pallet 1, 55x43x83 in, 580 lbs\npallet 2, 55x40x36 in, 220 lbs'
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

describe('kids bikes — su propio bulto, y ése se mide con la cinta', () => {
  // Se recogen al final (ROW 42) y las acomoda el picker: pesan y ocupan su
  // tarima, pero no hay geometría que calcular. Los pallets de bicis grandes
  // quedan intactos — lo que ensuciaba sus medidas ya tiene sitio propio.
  const kids = (id: number, qty: number) =>
    ({
      id,
      isParts: true,
      containerKind: 'smallBikes',
      items: [{ sku: '07-3742BK', pickingQty: qty }],
    }) as PalletForDeclaration;
  const conKids = [pallet(1, 10), kids(2, 12)];

  it('con más de dos se declara como bulto propio, sin tamaño', () => {
    const d = buildPalletDeclaration(conKids, [], () => BIKE, { kidsUnits: 12 });
    expect(d).toHaveLength(2);
    expect(d[1]).toMatchObject({ pallet: 2, isKids: true, needsTape: true, boxes: 12 });
    expect(d[1].size).toBeNull();
  });

  it('el pallet de bicis grandes conserva su cifra calculada', () => {
    const d = buildPalletDeclaration(conKids, [], () => BIKE, { kidsUnits: 12 });
    expect(d[0].needsTape).toBe(false);
    expect(d[0].size).toMatchObject({ length: 55, width: 40, height: 83 });
  });

  it('su peso es real: las cajas más la tarima', () => {
    // 12 × 45 + 40 de tarima. Es lo que hace que la suma de bultos cuadre con
    // el peso total de Ship, que ya cuenta 40 lb por pallet.
    expect(buildPalletDeclaration(conKids, [], () => BIKE, { kidsUnits: 12 })[1].weightLbs).toBe(
      580
    );
  });

  it('con dos o menos no se abre fila: caben en un hueco', () => {
    const d = buildPalletDeclaration([pallet(1, 10), kids(2, 2)], [], () => BIKE, { kidsUnits: 2 });
    expect(d).toHaveLength(1);
    expect(d[0].needsTape).toBe(false);
  });

  it('medido a mano se declara como cualquier otro', () => {
    const entry: PalletDimsEntry = {
      pallet: 2,
      length_in: 56,
      width_in: 44,
      height_in: 70,
      units: 12,
    };
    const d = buildPalletDeclaration(conKids, [entry], () => BIKE, { kidsUnits: 12 });
    expect(d[1].size).toMatchObject({ length: 56, width: 44, height: 70, source: 'manual' });
  });

  it('a medias no basta: sin los tres no hay bulto que declarar', () => {
    const entry: PalletDimsEntry = {
      pallet: 2,
      length_in: null,
      width_in: null,
      height_in: 70,
      units: 12,
    };
    expect(
      buildPalletDeclaration(conKids, [entry], () => BIKE, { kidsUnits: 12 })[1].size
    ).toBeNull();
  });

  it('el portapapeles lo nombra y no se calla el tamaño', () => {
    expect(
      palletClipboard(buildPalletDeclaration(conKids, [], () => BIKE, { kidsUnits: 12 }))
    ).toBe('pallet 1, 55x40x83 in, 490 lbs\nkids pallet, size ?, 580 lbs');
  });

  it('una carga de puras bicis de niño declara su bulto, no cero', () => {
    const d = buildPalletDeclaration([kids(1, 22)], [], () => BIKE, { kidsUnits: 22 });
    expect(d).toHaveLength(1);
    expect(d[0]).toMatchObject({ isKids: true, boxes: 22 });
    expect(palletClipboard(d)).toBe('1 pallet, size ?, 1030 lbs');
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
      isParts: true,
      containerKind: 'smallBikes',
      items: [{ sku: '07-3742BK', pickingQty: 12 }],
    } as PalletForDeclaration;
    const d = buildPalletDeclaration(
      [pallet(1, 10), kidsBox, partsBox(3, 6)],
      [],
      () => BIKE,
      ctx({ kidsUnits: 12 })
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
