import { describe, it, expect } from 'vitest';
import {
  allSameSize,
  buildPalletDeclaration,
  palletClipboard,
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

describe('kids bikes — el último bulto se mide con la cinta', () => {
  // Se recogen al final (ROW 42) y las acomoda el picker, así que el último
  // pallet no tiene geometría que calcular. El último, no el primero.
  const dos = [pallet(1, 12), pallet(2, 8)];

  it('con más de dos, el último pierde la cifra calculada', () => {
    const d = buildPalletDeclaration(dos, [], () => BIKE, 3);
    expect(d.map((p) => p.needsTape)).toEqual([false, true]);
    expect(d[0].size).not.toBeNull();
    expect(d[1].size).toBeNull();
  });

  it('con dos o menos no cambia nada', () => {
    const d = buildPalletDeclaration(dos, [], () => BIKE, 2);
    expect(d.every((p) => !p.needsTape)).toBe(true);
    expect(d[1].size).not.toBeNull();
  });

  it('medido a mano, el último se declara igual que cualquiera', () => {
    const entry: PalletDimsEntry = {
      pallet: 2,
      length_in: 56,
      width_in: 44,
      height_in: 70,
      units: 8,
    };
    const d = buildPalletDeclaration(dos, [entry], () => BIKE, 6);
    expect(d[1].size).toMatchObject({ length: 56, width: 44, height: 70, source: 'manual' });
  });

  it('a medias no basta: sin los tres no hay bulto que declarar', () => {
    const entry: PalletDimsEntry = {
      pallet: 2,
      length_in: null,
      width_in: null,
      height_in: 70,
      units: 8,
    };
    expect(buildPalletDeclaration(dos, [entry], () => BIKE, 6)[1].size).toBeNull();
  });

  it('el portapapeles lo dice en vez de callarlo', () => {
    const d = buildPalletDeclaration(dos, [], () => BIKE, 6);
    expect(palletClipboard(d)).toBe('pallet 1, 55x43x83 in, 580 lbs\npallet 2, size ?, 400 lbs');
  });

  it('con un solo pallet, ese es el último', () => {
    const d = buildPalletDeclaration([pallet(1, 12)], [], () => BIKE, 6);
    expect(d[0].needsTape).toBe(true);
    expect(palletClipboard(d)).toBe('1 pallet, size ?, 580 lbs');
  });
});
