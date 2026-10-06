import { describe, expect, it } from 'vitest';
import type { PalletDimsEntry } from '../../../../utils/palletDims';
import { planPallets } from '../../pallets/planPallets';
import { builtToRelease } from '../usePalletDims';

const entry = (pallet: number, over: Partial<PalletDimsEntry>): PalletDimsEntry => ({
  pallet,
  length_in: null,
  width_in: null,
  height_in: null,
  units: 0,
  ...over,
});

// #881828 a las 20:09: las dos tarimas armadas a mano (12 grandes / 7 de niño)
// y un 9 tecleado en la segunda que no movió nada.
const adults = Array.from({ length: 12 }, (_, i) => ({
  sku: `03-39${String(10 + i)}BK`,
  location: 'ROW 1',
  qty: 1,
}));
const kids = Array.from({ length: 7 }, (_, i) => ({
  sku: `07-37${String(40 + i)}RD`,
  location: 'ROW 42',
  qty: 1,
}));
const built = [entry(1, { bikes: 10, items: adults }), entry(2, { items: kids })];

describe('builtToRelease', () => {
  it('una cifra que contradice lo armado suelta todas las tarimas armadas', () => {
    expect(builtToRelease(built, 2, 9)).toEqual([1, 2]);
  });

  it('si la cifra es la que ya lleva a mano, no suelta nada', () => {
    expect(builtToRelease(built, 2, 7)).toEqual([]);
  });

  it('sin tarimas armadas, o borrando la cifra, no hay nada que soltar', () => {
    expect(builtToRelease([entry(1, { bikes: 10 })], 1, 9)).toEqual([]);
    expect(builtToRelease(built, 2, null)).toEqual([]);
  });

  it('#881828: soltadas, el motor da 10 y 9 con las cifras', () => {
    const lines = [...adults, ...kids].map((l) => ({
      sku: l.sku,
      location: l.location,
      pickingQty: 1,
    }));
    const sets = {
      bikes: new Set(lines.map((l) => l.sku)),
      smallBikes: new Set(kids.map((k) => k.sku)),
    };
    const floor = [entry(1, { bikes: 10 }), entry(2, { bikes: 9 })];
    expect(planPallets(lines, sets, { floor }).map((p) => p.totalUnits)).toEqual([10, 9]);
  });
});
