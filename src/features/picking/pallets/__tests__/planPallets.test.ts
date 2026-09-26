import { describe, expect, it } from 'vitest';
import {
  calculatePalletsWithBikeAwareness,
  redistributeWithOverrides,
} from '../../../../utils/pickingLogic';
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

describe('planPallets — paridad con lo que hacía cada pantalla (paso 1)', () => {
  it('sin ajustes es calculatePalletsWithBikeAwareness tal cual', () => {
    expect(planPallets(lines, sets)).toEqual(
      calculatePalletsWithBikeAwareness(lines, sets.bikes, sets.smallBikes)
    );
  });

  it('con los ajustes del picker es redistributeWithOverrides tal cual', () => {
    const overrides = new Map([
      [1, 11],
      [2, 12],
      [3, 12],
    ]);
    expect(planPallets(lines, sets, { overrides })).toEqual(
      redistributeWithOverrides(
        calculatePalletsWithBikeAwareness(lines, sets.bikes, sets.smallBikes),
        overrides
      )
    );
  });

  it('un mapa de ajustes vacío no cambia nada', () => {
    expect(planPallets(lines, sets, { overrides: new Map() })).toEqual(planPallets(lines, sets));
  });
});

describe('countPhysicalPallets — el conteo de hoy', () => {
  it('deja fuera la tarima de niño (R2; F0 lo corrige aquí)', () => {
    const pallets = planPallets(lines, sets);
    const kids = pallets.filter((p) => p.containerKind === 'smallBikes');
    expect(kids).toHaveLength(1);
    expect(countPhysicalPallets(pallets)).toBe(pallets.length - 1);
  });

  it('una carga sólo de niño cuenta 0 (#881418; F0 lo corrige aquí)', () => {
    const soloNinos = planPallets(ninos, { bikes: sets.smallBikes, smallBikes: sets.smallBikes });
    expect(countPhysicalPallets(soloNinos)).toBe(0);
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
