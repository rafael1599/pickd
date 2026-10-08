import { describe, expect, it } from 'vitest';
import { calculatePalletsWithBikeAwareness } from '../../../../utils/pickingLogic';
import {
  KIDS_SPLIT_MAX,
  type PalletBoxMeta,
  type PalletDimsEntry,
} from '../../../../utils/palletDims';
import { layoutPallet } from '../../../../utils/palletLayout';
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

  it('las de niño son tarimas y cuentan (R2): WILMETTE sin catálogo = 3 grandes + 2 de niño (tope 15)', () => {
    const pallets = planPallets(lines, sets);
    // Parejas (8 oct 2026): 11 + 10 + 10 en grandes, y 25 de niño en 13 + 12 (tope 15 por tarima).
    expect(summary(pallets)).toEqual([
      [1, 'bikes', 11],
      [2, 'bikes', 10],
      [3, 'bikes', 10],
      [4, 'smallBikes', 13],
      [5, 'smallBikes', 12],
    ]);
    expect(countPhysicalPallets(pallets)).toBe(5);
  });

  it('una carga sólo de niño tiene sus tarimas (#881418, 25 bicis = 2 tarimas por tope 15)', () => {
    const soloNinos = planPallets(ninos, { bikes: sets.smallBikes, smallBikes: sets.smallBikes });
    expect(countPhysicalPallets(soloNinos)).toBe(2);
    expect(summary(soloNinos)).toEqual([
      [1, 'smallBikes', 13],
      [2, 'smallBikes', 12],
    ]);
  });

  it('dos o menos de niño van encima de la tarima grande más baja, nunca en un contenedor', () => {
    const pocos = [...grandes, { sku: '07-3744BL', location: 'ROW 42', pickingQty: 2 }];
    const pallets = planPallets(pocos, sets);
    // 31 + 2 = 33: once en cada una, la que las lleva con 9 grandes.
    expect(summary(pallets)).toEqual([
      [1, 'bikes', 11],
      [2, 'bikes', 11],
      [3, 'bikes', 11],
    ]);
    expect(pallets[2].items.filter((i) => sets.smallBikes.has(i.sku))).toHaveLength(1);
    expect(countPhysicalPallets(pallets)).toBe(3);
  });

  it('si ninguna tarima grande las aguanta (o no hay), van en la suya', () => {
    const doce = [{ sku: '03-4665GN', location: 'ROW 1', pickingQty: 12 }];
    const dos = { sku: '07-3744BL', location: 'ROW 42', pickingQty: 2 };
    // 12 grandes + 2 de niño: mínimo 2 tarimas; con 2 fijas se reparte parejo (7 y 7).
    expect(summary(planPallets([...doce, dos], sets))).toEqual([
      [1, 'bikes', 7],
      [2, 'bikes', 7],
    ]);
    const solo = planPallets([dos], sets);
    expect(summary(solo)).toEqual([[1, 'smallBikes', 2]]);
    expect(countPhysicalPallets(solo)).toBe(1);
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

// #881764 (28 sep 2026): 14 grandes + 2 Juv Laser 2.0. Ship pintaba 8 + 6 y las
// dos Laser no salían en ninguna fila: vivían en un contenedor que nadie pinta.
describe('planPallets — #881764, las de niño encima de la tarima de 6', () => {
  const orden = [
    { sku: '03-3740BK', location: 'ROW 1', pickingQty: 1 },
    { sku: '03-3768BL', location: 'ROW 43', pickingQty: 2 },
    { sku: '03-3777RD', location: 'ROW 33', pickingQty: 1 },
    { sku: '03-3778BK', location: 'ROW 9', pickingQty: 1 },
    { sku: '03-4639MN', location: 'ROW 9', pickingQty: 1 },
    { sku: '03-4663GN', location: 'ROW 5', pickingQty: 2 },
    { sku: '03-4665GN', location: 'ROW 1', pickingQty: 2 },
    { sku: '03-4667BR', location: 'ROW 5', pickingQty: 1 },
    { sku: '06-4438BK', location: 'ROW 23', pickingQty: 1 },
    { sku: '06-4454BK', location: 'ROW 28', pickingQty: 1 },
    { sku: '06-4458SL', location: 'ROW 23', pickingQty: 1 },
    { sku: '07-3744BL', location: 'ROW 42', pickingQty: 2 },
  ];
  const s881764 = {
    bikes: new Set(orden.map((l) => l.sku)),
    smallBikes: new Set(['07-3744BL']),
  };
  const meta: Record<string, PalletBoxMeta> = {
    '03-3740BK': { length_in: 58, width_in: 9, height_in: 30 },
    '03-3768BL': { length_in: 56, width_in: 9, height_in: 29 },
    '03-3777RD': { length_in: 61, width_in: 8.55, height_in: 31 },
    '03-3778BK': { length_in: 61, width_in: 8.75, height_in: 31 },
    '03-4639MN': { length_in: 57, width_in: 9, height_in: 30 },
    '03-4663GN': { length_in: 55.75, width_in: 8.5, height_in: 29 },
    '03-4665GN': { length_in: 56.5, width_in: 8.75, height_in: 30 },
    '03-4667BR': { length_in: 63, width_in: 9, height_in: 32 },
    '06-4438BK': { length_in: 55, width_in: 8.5, height_in: 30 },
    '06-4454BK': { length_in: 54.88, width_in: 8.75, height_in: 27.52 },
    '06-4458SL': { length_in: 55.5, width_in: 8.75, height_in: 30.35 },
    '07-3744BL': { length_in: 43, width_in: 8.5, height_in: 22 },
  };
  const metaFor = (sku: string) => meta[sku];
  const floorAt = (pallet: number, bikes: number): PalletDimsEntry => ({
    pallet,
    length_in: null,
    width_in: null,
    height_in: null,
    units: 6,
    bikes,
  });

  it('sin nada tecleado: 8 + 8, las dos Laser en la segunda', () => {
    const pallets = planPallets(orden, s881764, { metaFor });
    expect(summary(pallets)).toEqual([
      [1, 'bikes', 8],
      [2, 'bikes', 8],
    ]);
    expect(pallets[1].items[pallets[1].items.length - 1]).toMatchObject({
      sku: '07-3744BL',
      pickingQty: 2,
    });
  });

  it('con el 8 / 8 que tecleó la estación: la cifra es el total de la fila y nada se muda', () => {
    const pallets = planPallets(orden, s881764, {
      metaFor,
      floor: [floorAt(1, 8), floorAt(2, 8)],
    });
    expect(summary(pallets)).toEqual([
      [1, 'bikes', 8],
      [2, 'bikes', 8],
    ]);
    expect(pallets[0].items.some((i) => i.sku === '07-3744BL')).toBe(false);
  });

  it('teclear la de las Laser no las cambia de tarima', () => {
    const pallets = planPallets(orden, s881764, { metaFor, floor: [floorAt(2, 7)] });
    expect(summary(pallets)).toEqual([
      [1, 'bikes', 9],
      [2, 'bikes', 7],
    ]);
    expect(pallets[1].items[pallets[1].items.length - 1]?.sku).toBe('07-3744BL');
  });
});

describe('planPallets — tarimas parejas, la de 12 como último recurso (#881828)', () => {
  // Rafael, 5 oct 2026: 12 grandes + 7 de niño salía 12 y 7, y teclear 10 en la
  // primera no hacía nada — no había otra grande a la que mandar las 2.
  const orden = [
    { sku: '03-3922BL', location: 'ROW 1', pickingQty: 1 },
    { sku: '03-3933BK', location: 'ROW 1', pickingQty: 2 },
    { sku: '03-3927BK', location: 'ROW 2', pickingQty: 1 },
    { sku: '03-4537GY', location: 'ROW 2', pickingQty: 2 },
    { sku: '03-3935BK', location: 'ROW 3', pickingQty: 1 },
    { sku: '03-3929BK', location: 'ROW 5', pickingQty: 1 },
    { sku: '03-4539GY', location: 'ROW 22', pickingQty: 1 },
    { sku: '03-3931BK', location: 'ROW 28', pickingQty: 1 },
    { sku: '03-3928BL', location: 'ROW 42', pickingQty: 1 },
    { sku: '03-3936MN', location: 'ROW 43', pickingQty: 1 },
    { sku: '07-3689WH', location: 'ROW 42', pickingQty: 1 },
    { sku: '07-3741RD', location: 'ROW 42', pickingQty: 1 },
    { sku: '07-3742BK', location: 'ROW 42', pickingQty: 1 },
    { sku: '07-3743PK', location: 'ROW 42', pickingQty: 1 },
    { sku: '07-3744BL', location: 'ROW 42', pickingQty: 1 },
    { sku: '07-3745WH', location: 'ROW 42', pickingQty: 1 },
    { sku: '07-3746PU', location: 'ROW 42', pickingQty: 1 },
  ];
  const s881828 = {
    bikes: new Set(orden.map((l) => l.sku)),
    smallBikes: new Set(orden.filter((l) => l.sku.startsWith('07-')).map((l) => l.sku)),
  };
  const metaFor = (sku: string): PalletBoxMeta =>
    sku === '07-3689WH'
      ? { length_in: 48, width_in: 9, height_in: 26 }
      : ['07-3741RD', '07-3742BK', '07-3743PK'].includes(sku)
        ? { length_in: 37, width_in: 8, height_in: 17.5 }
        : sku.startsWith('07-')
          ? { length_in: 43, width_in: 8.5, height_in: 22 }
          : { length_in: 54, width_in: 9, height_in: 29.5 };
  const floorAt = (pallet: number, bikes: number): PalletDimsEntry => ({
    pallet,
    length_in: null,
    width_in: null,
    height_in: null,
    units: 0,
    bikes,
  });
  const grandesEn = (p: ReturnType<typeof planPallets>[number]) =>
    p.items.filter((i) => !s881828.smallBikes.has(i.sku)).reduce((t, i) => t + i.pickingQty, 0);

  it('sin nada tecleado: 10 y 9, dos grandes abajo de las de niño', () => {
    const pallets = planPallets(orden, s881828, { metaFor });
    expect(summary(pallets)).toEqual([
      [1, 'bikes', 10],
      [2, 'bikes', 9],
    ]);
    expect(grandesEn(pallets[1])).toBe(2);
  });

  it('el 10 tecleado en la primera manda las otras 2 a la de niño', () => {
    const pallets = planPallets(orden, s881828, { metaFor, floor: [floorAt(1, 10)] });
    expect(summary(pallets)).toEqual([
      [1, 'bikes', 10],
      [2, 'bikes', 9],
    ]);
  });

  it('el 12 tecleado deja la de niño sola', () => {
    const pallets = planPallets(orden, s881828, { metaFor, floor: [floorAt(1, 12)] });
    expect(summary(pallets)).toEqual([
      [1, 'bikes', 12],
      [2, 'smallBikes', 7],
    ]);
  });

  it('en la de niño, la cifra es el total de la fila', () => {
    const pallets = planPallets(orden, s881828, { metaFor, floor: [floorAt(2, 11)] });
    expect(summary(pallets)).toEqual([
      [1, 'bikes', 8],
      [2, 'bikes', 11],
    ]);
  });
});

describe('planPallets — si todo cabe en una tarima, una (#881678 / #881780)', () => {
  // 1 HELIX + 3 LASER, combinadas el 29 sep 2026: salían en dos tarimas.
  const orden = [
    { sku: '03-4637MN', location: 'ROW 2', pickingQty: 1 },
    { sku: '07-3743PK', location: 'ROW 42', pickingQty: 2 },
    { sku: '07-3746PU', location: 'ROW 42', pickingQty: 1 },
  ];
  const s = {
    bikes: new Set(orden.map((l) => l.sku)),
    smallBikes: new Set(['07-3743PK', '07-3746PU']),
  };
  const meta: Record<string, PalletBoxMeta> = {
    '03-4637MN': { length_in: 56, width_in: 9, height_in: 30 },
    '07-3743PK': { length_in: 37, width_in: 8, height_in: 18 },
    '07-3746PU': { length_in: 43, width_in: 8.5, height_in: 22 },
  };
  const metaFor = (sku: string) => meta[sku];

  it('las 4 van en una sola tarima', () => {
    expect(summary(planPallets(orden, s, { metaFor }))).toEqual([[1, 'bikes', 4]]);
  });

  it('pero si el piso partió las de niño («+/–»), manda el piso', () => {
    const floor: PalletDimsEntry[] = [
      { pallet: 2, length_in: null, width_in: null, height_in: null, units: 3, split: 2 },
    ];
    expect(countPhysicalPallets(planPallets(orden, s, { metaFor, floor }))).toBeGreaterThan(1);
  });
});

describe('planPallets — parejo sólo si no cuesta tarimas (8 oct 2026)', () => {
  const makeAdultOrder = (qty: number) => [
    { sku: '03-3980BL', location: 'ROW 34', pickingQty: qty },
  ];
  const setsAdult = {
    bikes: new Set(['03-3980BL']),
    smallBikes: new Set<string>(),
  };

  it('22 grandes → 2 tarimas de 11/11 (no 12/10)', () => {
    const pallets = planPallets(makeAdultOrder(22), setsAdult);
    expect(summary(pallets)).toEqual([
      [1, 'bikes', 11],
      [2, 'bikes', 11],
    ]);
    expect(countPhysicalPallets(pallets)).toBe(2);
  });

  it('24 grandes → 2 tarimas de 12/12 (ahorra una tarima frente a 3)', () => {
    const pallets = planPallets(makeAdultOrder(24), setsAdult);
    expect(summary(pallets)).toEqual([
      [1, 'bikes', 12],
      [2, 'bikes', 12],
    ]);
    expect(countPhysicalPallets(pallets)).toBe(2);
  });

  it('25 grandes → 3 tarimas de 9/8/8 (no 12/12/1)', () => {
    const pallets = planPallets(makeAdultOrder(25), setsAdult);
    expect(summary(pallets)).toEqual([
      [1, 'bikes', 9],
      [2, 'bikes', 8],
      [3, 'bikes', 8],
    ]);
    expect(countPhysicalPallets(pallets)).toBe(3);
  });

  it('26 grandes → 3 tarimas de 9/9/8 (no 12/12/2)', () => {
    const pallets = planPallets(makeAdultOrder(26), setsAdult);
    expect(summary(pallets)).toEqual([
      [1, 'bikes', 9],
      [2, 'bikes', 9],
      [3, 'bikes', 8],
    ]);
    expect(countPhysicalPallets(pallets)).toBe(3);
  });
});

describe('planPallets — topes: 15 de niño, 12 grandes (8 oct 2026)', () => {
  const CAPRI = '07-3690BL';
  const LASER = '07-3744BL';
  const meta: Record<string, PalletBoxMeta> = {
    [CAPRI]: { length_in: 48, width_in: 9, height_in: 26, weight_lbs: 38.6 },
    [LASER]: { length_in: 43, width_in: 8.5, height_in: 22, weight_lbs: 32.19 },
  };
  const setsKids = (skus: string[]) => ({
    bikes: new Set(skus),
    smallBikes: new Set(skus),
  });

  it('15 de niño caben en 1 sola tarima (tope máximo 15)', () => {
    const orden = [{ sku: LASER, location: 'ROW 42', pickingQty: 15 }];
    const pallets = planPallets(orden, setsKids([LASER]));
    expect(summary(pallets)).toEqual([[1, 'smallBikes', 15]]);
    expect(countPhysicalPallets(pallets)).toBe(1);
  });

  it('16 de niño con catálogo → 8 + 8 cortando por modelo', () => {
    const orden = [
      { sku: CAPRI, location: 'ROW 42', pickingQty: 8 },
      { sku: LASER, location: 'ROW 42', pickingQty: 8 },
    ];
    const pallets = planPallets(orden, setsKids([CAPRI, LASER]), { metaFor: (sku) => meta[sku] });
    expect(summary(pallets)).toEqual([
      [1, 'smallBikes', 8],
      [2, 'smallBikes', 8],
    ]);
    expect(countPhysicalPallets(pallets)).toBe(2);
  });

  it('16 de niño sin catálogo → 8 + 8', () => {
    const orden = [{ sku: LASER, location: 'ROW 42', pickingQty: 16 }];
    const pallets = planPallets(orden, setsKids([LASER]));
    expect(summary(pallets)).toEqual([
      [1, 'smallBikes', 8],
      [2, 'smallBikes', 8],
    ]);
    expect(countPhysicalPallets(pallets)).toBe(2);
  });
});

describe('planPallets — #881856 (8 oct 2026)', () => {
  const meta881856: Record<string, PalletBoxMeta> = {
    '03-3980BL': { length_in: 55, width_in: 9, height_in: 29 },
    '03-3981GY': { length_in: 55, width_in: 9, height_in: 29 },
    '03-3983GY': { length_in: 55, width_in: 9, height_in: 30 },
    '03-3987GY': { length_in: 55, width_in: 8.5, height_in: 29 },
    '03-3989GY': { length_in: 55, width_in: 8.5, height_in: 30.5 },
    '07-3689WH': { length_in: 48, width_in: 9, height_in: 26 },
    '07-3690BL': { length_in: 48, width_in: 9, height_in: 26 },
  };
  const metaFor881856 = (sku: string) => meta881856[sku];

  // Recorrido exacto de recogida:
  // ROW 34 5×03-3980BL → ROW 32 5×03-3983GY → ROW 9 6×03-3987GY + 5×03-3989GY
  // → ROW 42 3×07-3689WH + 3×07-3690BL de niño → ROW 43 8×03-3981GY
  const orden881856 = [
    { sku: '03-3980BL', location: 'ROW 34', pickingQty: 5 },
    { sku: '03-3983GY', location: 'ROW 32', pickingQty: 5 },
    { sku: '03-3987GY', location: 'ROW 9', pickingQty: 6 },
    { sku: '03-3989GY', location: 'ROW 9', pickingQty: 5 },
    { sku: '07-3689WH', location: 'ROW 42', pickingQty: 3 },
    { sku: '07-3690BL', location: 'ROW 42', pickingQty: 3 },
    { sku: '03-3981GY', location: 'ROW 43', pickingQty: 8 },
  ];
  const s881856 = {
    bikes: new Set(orden881856.map((l) => l.sku)),
    smallBikes: new Set(['07-3689WH', '07-3690BL']),
  };

  it('sin nada a mano: 3 tarimas en orden de recogida, T3 con 5 grandes + 6 de niño (≤ 90")', () => {
    const pallets = planPallets(orden881856, s881856, { metaFor: metaFor881856 });
    expect(countPhysicalPallets(pallets)).toBe(3);
    expect(summary(pallets)).toEqual([
      [1, 'bikes', 12],
      [2, 'bikes', 12],
      [3, 'bikes', 11],
    ]);

    // T1: 5× 03-3980BL + 5× 03-3983GY + 2× 03-3987GY
    expect(pallets[0].items).toEqual([
      { sku: '03-3980BL', location: 'ROW 34', pickingQty: 5 },
      { sku: '03-3983GY', location: 'ROW 32', pickingQty: 5 },
      { sku: '03-3987GY', location: 'ROW 9', pickingQty: 2 },
    ]);

    // T2: 4× 03-3987GY + 5× 03-3989GY + 3× 03-3981GY
    expect(pallets[1].items).toEqual([
      { sku: '03-3987GY', location: 'ROW 9', pickingQty: 4 },
      { sku: '03-3989GY', location: 'ROW 9', pickingQty: 5 },
      { sku: '03-3981GY', location: 'ROW 43', pickingQty: 3 },
    ]);

    // T3: 5× 03-3981GY + 6 de niño (3× 07-3689WH + 3× 07-3690BL)
    expect(pallets[2].items).toEqual([
      { sku: '03-3981GY', location: 'ROW 43', pickingQty: 5 },
      { sku: '07-3689WH', location: 'ROW 42', pickingQty: 3 },
      { sku: '07-3690BL', location: 'ROW 42', pickingQty: 3 },
    ]);

    // Medidas reales: todas ≤ 90"
    const isKid = (sku: string) => s881856.smallBikes.has(sku);
    for (const p of pallets) {
      const layout = layoutPallet(p.items, metaFor881856, isKid);
      expect(layout).not.toBeNull();
      expect(layout!.overHeight).toBe(false);
      expect(layout!.height).toBeLessThanOrEqual(90);
    }
  });

  it('con el piso: T1 manual 12 y T2 manual 12 → T3 = 5 grandes + 6 de niño (3 tarimas)', () => {
    const floor: PalletDimsEntry[] = [
      {
        pallet: 1,
        length_in: null,
        width_in: null,
        height_in: null,
        units: 12,
        items: [
          { sku: '03-3980BL', location: 'ROW 34', qty: 5 },
          { sku: '03-3983GY', location: 'ROW 32', qty: 4 },
          { sku: '03-3989GY', location: 'ROW 9', qty: 3 },
        ],
      },
      {
        pallet: 2,
        length_in: null,
        width_in: null,
        height_in: null,
        units: 12,
        items: [
          { sku: '03-3983GY', location: 'ROW 32', qty: 1 },
          { sku: '03-3987GY', location: 'ROW 9', qty: 6 },
          { sku: '03-3989GY', location: 'ROW 9', qty: 2 },
          { sku: '03-3981GY', location: 'ROW 43', qty: 3 },
        ],
      },
    ];
    const pallets = planPallets(orden881856, s881856, { metaFor: metaFor881856, floor });
    expect(countPhysicalPallets(pallets)).toBe(3);
    expect(summary(pallets)).toEqual([
      [1, 'bikes', 12],
      [2, 'bikes', 12],
      [3, 'bikes', 11],
    ]);
    expect(pallets[2].items).toEqual([
      { sku: '03-3981GY', location: 'ROW 43', pickingQty: 5 },
      { sku: '07-3689WH', location: 'ROW 42', pickingQty: 3 },
      { sku: '07-3690BL', location: 'ROW 42', pickingQty: 3 },
    ]);
  });

  it('con P1 manual 9 y P2 manual 9: remanente exige 2 tarimas más (total 4: 9, 9, 9, 8)', () => {
    const floor: PalletDimsEntry[] = [
      {
        pallet: 1,
        length_in: null,
        width_in: null,
        height_in: null,
        units: 9,
        items: [
          { sku: '03-3980BL', location: 'ROW 34', qty: 5 },
          { sku: '03-3983GY', location: 'ROW 32', qty: 4 },
        ],
      },
      {
        pallet: 2,
        length_in: null,
        width_in: null,
        height_in: null,
        units: 9,
        items: [
          { sku: '03-3983GY', location: 'ROW 32', qty: 1 },
          { sku: '03-3987GY', location: 'ROW 9', qty: 6 },
          { sku: '03-3989GY', location: 'ROW 9', qty: 2 },
        ],
      },
    ];
    const pallets = planPallets(orden881856, s881856, { metaFor: metaFor881856, floor });
    expect(countPhysicalPallets(pallets)).toBe(4);
    expect(summary(pallets)).toEqual([
      [1, 'bikes', 9],
      [2, 'bikes', 9],
      [3, 'bikes', 9],
      [4, 'bikes', 8],
    ]);
  });
});
