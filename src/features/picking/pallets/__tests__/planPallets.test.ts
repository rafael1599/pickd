import { describe, expect, it } from 'vitest';
import { calculatePalletsWithBikeAwareness } from '../../../../utils/pickingLogic';
import {
  KIDS_SPLIT_MAX,
  type PalletBoxMeta,
  type PalletDimsEntry,
} from '../../../../utils/palletDims';
import { countPhysicalPallets, locationsFromInventory, planPallets } from '../planPallets';

// WILMETTE (#881735 / #881644 / #881645, 25 sep 2026): 31 grandes + 25 de niño.
const grandes = [
  { sku: '03-4662YL', location: 'ROW 1', pickingQty: 2 },
  { sku: '03-4665GN', location: 'ROW 1', pickingQty: 4 },
  { sku: '03-3987GY', location: 'ROW 12', pickingQty: 1 },
  { sku: '03-3988TL', location: 'ROW 13', pickingQty: 2 },
  { sku: '03-3989GY', location: 'ROW 13', pickingQty: 1 },
  { sku: '03-3990TL', location: 'ROW 14', pickingQty: 1 },
  { sku: '03-3978BL', location: 'ROW 14', pickingQty: 1 },
  { sku: '03-4664YL', location: 'ROW 2', pickingQty: 2 },
  { sku: '03-3753BL', location: 'ROW 29', pickingQty: 3 },
  { sku: '03-3983GY', location: 'ROW 33', pickingQty: 1 },
  { sku: '03-3977GY', location: 'ROW 41', pickingQty: 1 },
  { sku: '03-3981GY', location: 'ROW 43', pickingQty: 2 },
  { sku: '03-3979GY', location: 'ROW 43', pickingQty: 1 },
  { sku: '03-4663GN', location: 'ROW 5', pickingQty: 4 },
  { sku: '03-3751BL', location: 'ROW 9', pickingQty: 3 },
  { sku: '03-3778BK', location: 'ROW 9', pickingQty: 2 },
];
const ninos = [
  { sku: '07-3743PK', location: 'ROW 42', pickingQty: 6 },
  { sku: '07-3744BL', location: 'ROW 42', pickingQty: 5 },
  { sku: '07-3745WH', location: 'ROW 42', pickingQty: 3 },
  { sku: '07-3746PU', location: 'ROW 42', pickingQty: 5 },
  { sku: '07-3741RD', location: 'ROW 42', pickingQty: 6 },
];
const lines = [...grandes, ...ninos];
const sets = {
  bikes: new Set(lines.map((l) => l.sku)),
  smallBikes: new Set(ninos.map((l) => l.sku)),
};

const units = (p: { items: { pickingQty: number }[] }) =>
  p.items.reduce((sum, i) => sum + i.pickingQty, 0);
const summary = (pallets: ReturnType<typeof planPallets>) =>
  pallets.map((p) => [p.id, p.isParts ? 'container' : (p.containerKind ?? 'bikes'), units(p)]);

describe('planPallets — sin nada dicho por el piso', () => {
  it('las grandes, igual que calculatePalletsWithBikeAwareness', () => {
    const base = calculatePalletsWithBikeAwareness(grandes, sets.bikes, sets.smallBikes);
    expect(planPallets(grandes, sets).map(units)).toEqual(base.map(units));
  });

  it('las de niño son tarimas y cuentan (R2): WILMETTE sin catálogo = 3 grandes + 1 de niño', () => {
    const pallets = planPallets(lines, sets);
    expect(summary(pallets)).toEqual([
      [1, 'bikes', 12],
      [2, 'bikes', 12],
      [3, 'bikes', 7],
      [4, 'smallBikes', 25],
    ]);
    expect(countPhysicalPallets(pallets)).toBe(4);
  });

  it('una carga sólo de niño tiene su tarima (#881418)', () => {
    const soloNinos = planPallets(ninos, { bikes: sets.smallBikes, smallBikes: sets.smallBikes });
    expect(countPhysicalPallets(soloNinos)).toBe(1);
  });

  it('dos o menos de niño viajan en un hueco: contenedor, numerado al final', () => {
    const pocos = [...grandes, { sku: '07-3744BL', location: 'ROW 42', pickingQty: 2 }];
    const pallets = planPallets(pocos, sets);
    expect(summary(pallets)[summary(pallets).length - 1]).toEqual([4, 'container', 2]);
    expect(countPhysicalPallets(pallets)).toBe(3);
  });

  it('no muta su entrada', () => {
    const copy = JSON.parse(JSON.stringify(lines));
    planPallets(lines, sets, {
      floor: [{ pallet: 1, length_in: null, width_in: null, height_in: null, units: 0, bikes: 5 }],
    });
    expect(lines).toEqual(copy);
  });
});

describe('planPallets — lo que dijo el piso manda (pallet_dims)', () => {
  const entry = (pallet: number, over: Partial<PalletDimsEntry>): PalletDimsEntry => ({
    pallet,
    length_in: null,
    width_in: null,
    height_in: null,
    units: 0,
    ...over,
  });

  it('WILMETTE: 11 / 10 / 10 tecleado en las grandes, y la de niño en 2 (13 + 12)', () => {
    const pallets = planPallets(lines, sets, {
      floor: [entry(1, { bikes: 11 }), entry(2, { bikes: 10 }), entry(4, { split: 2 })],
    });
    expect(summary(pallets)).toEqual([
      [1, 'bikes', 11],
      [2, 'bikes', 10],
      [3, 'bikes', 10],
      [4, 'smallBikes', 13],
      [5, 'smallBikes', 12],
    ]);
    // Nunca se mezcla niño con grandes al corregir (R4).
    expect(
      pallets.slice(0, 3).every((p) => p.items.every((i) => !sets.smallBikes.has(i.sku)))
    ).toBe(true);
  });

  it('una tarima armada a mano se aparta con su ordinal y el resto se reparte alrededor', () => {
    const pallets = planPallets(lines, sets, {
      floor: [
        entry(6, {
          items: [
            { sku: '03-4663GN', location: 'ROW 5', qty: 4 },
            { sku: '07-3744BL', qty: 5 },
          ],
        }),
      ],
    });
    const manual = pallets.find((p) => p.id === 6)!;
    expect(manual.manual).toBe(true);
    expect(units(manual)).toBe(9);
    // Conserva de dónde sale cada línea: las marcas de Double Check van por ubicación.
    expect(manual.items.find((i) => i.sku === '03-4663GN')?.location).toBe('ROW 5');
    // 56 unidades en total, ni una más ni una menos.
    expect(pallets.reduce((sum, p) => sum + units(p), 0)).toBe(56);
    expect(countPhysicalPallets(pallets)).toBe(pallets.length);
  });

  it('un «+/–» exagerado se acota: nunca más de KIDS_SPLIT_MAX tarimas de niño', () => {
    const pallets = planPallets(lines, sets, { floor: [entry(4, { split: 99 })] });
    expect(pallets.filter((p) => p.containerKind === 'smallBikes')).toHaveLength(KIDS_SPLIT_MAX);
  });

  it('pedir más de lo que hay a mano se queda en lo que hay', () => {
    const pallets = planPallets(lines, sets, {
      floor: [entry(9, { items: [{ sku: '03-3979GY', qty: 50 }] })],
    });
    expect(units(pallets.find((p) => p.id === 9)!)).toBe(1);
  });

  it('una tarima a mano sólo de niño se mide como de niño', () => {
    const pallets = planPallets(lines, sets, {
      floor: [entry(7, { items: [{ sku: '07-3743PK', qty: 6 }] })],
    });
    expect(pallets.find((p) => p.id === 7)).toMatchObject({
      manual: true,
      containerKind: 'smallBikes',
    });
  });
});

describe('planPallets — la regla de niño con catálogo (#881677)', () => {
  const CAPRI = '07-3690BL';
  const LASER = '07-3744BL';
  const meta: Record<string, PalletBoxMeta> = {
    [CAPRI]: { length_in: 48, width_in: 9, height_in: 26, weight_lbs: 38.6 },
    [LASER]: { length_in: 43, width_in: 8.5, height_in: 22, weight_lbs: 32.19 },
  };
  const orden = [
    { sku: '03-4040BK', location: 'ROW 24', pickingQty: 5 },
    { sku: CAPRI, location: 'ROW 42', pickingQty: 10 },
    { sku: LASER, location: 'ROW 42', pickingQty: 15 },
  ];
  const s = {
    bikes: new Set(orden.map((l) => l.sku)),
    smallBikes: new Set([CAPRI, LASER]),
  };

  it('10 Capri + 15 Laser, cortando por modelo, como la armó el piso', () => {
    expect(summary(planPallets(orden, s, { metaFor: (sku) => meta[sku] }))).toEqual([
      [1, 'bikes', 5],
      [2, 'smallBikes', 10],
      [3, 'smallBikes', 15],
    ]);
  });
});

describe('locationsFromInventory', () => {
  it('arma la forma que pide la ruta, sin inventar ranking', () => {
    expect(
      locationsFromInventory([{ location_id: 'x', location: 'ROW 3', warehouse: 'LUDLOW' }])
    ).toEqual([
      {
        id: 'x',
        location: 'ROW 3',
        warehouse: 'LUDLOW',
        zone: null,
        max_capacity: null,
        picking_order: null,
        is_active: true,
        counts_as_storage: true,
        pick_priority: 'normal',
        created_at: '',
        length_ft: null,
        bike_line: null,
      },
    ]);
  });
});
