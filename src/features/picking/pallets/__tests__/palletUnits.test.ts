import { describe, expect, it } from 'vitest';
import { applyPalletSelection, palletUnits } from '../palletUnits';
import type { PlannedPallet } from '../planPallets';

const pallet = (
  id: number,
  items: { sku: string; location: string; pickingQty: number }[],
  manual = false
): PlannedPallet =>
  ({
    id,
    items,
    totalUnits: items.reduce((s, i) => s + i.pickingQty, 0),
    footprint_in2: 0,
    limitPerPallet: 0,
    manual,
  }) as unknown as PlannedPallet;

const pallets = [
  pallet(1, [
    { sku: 'A', location: 'ROW 1', pickingQty: 2 },
    { sku: 'B', location: 'ROW 2', pickingQty: 1 },
  ]),
  pallet(2, [{ sku: 'C', location: 'ROW 3', pickingQty: 2 }], true),
  pallet(3, [{ sku: 'PART', location: 'E1', pickingQty: 5 }]),
];
const units = palletUnits(
  pallets,
  (sku) => sku !== 'PART',
  () => false,
  (id) => id
);

describe('palletUnits', () => {
  it('una fila por caja, sin partes, cada una con su tarima', () => {
    expect(units.map((u) => `${u.sku}${u.fromLabel}`)).toEqual(['A#1', 'A#1', 'B#1', 'C#2', 'C#2']);
    expect(units.filter((u) => u.fromManual)).toHaveLength(2);
  });
});

describe('applyPalletSelection', () => {
  it('la tarima editada queda armada a mano con lo elegido', () => {
    const selected = units.filter((u) => u.sku === 'A');
    expect(applyPalletSelection(1, selected, units)).toEqual([
      { pallet: 1, items: [{ sku: 'A', location: 'ROW 1', qty: 2 }] },
    ]);
  });

  it('traer una caja de otra tarima armada a mano se la quita a esa', () => {
    const selected = [
      ...units.filter((u) => u.fromPallet === 1),
      units.find((u) => u.sku === 'C')!,
    ];
    const writes = applyPalletSelection(1, selected, units);
    expect(writes).toContainEqual({
      pallet: 1,
      items: [
        { sku: 'A', location: 'ROW 1', qty: 2 },
        { sku: 'B', location: 'ROW 2', qty: 1 },
        { sku: 'C', location: 'ROW 3', qty: 1 },
      ],
    });
    expect(writes).toContainEqual({ pallet: 2, items: [{ sku: 'C', location: 'ROW 3', qty: 1 }] });
  });

  it('sin nada marcado vuelve al reparto', () => {
    expect(applyPalletSelection(1, [], units)).toEqual([{ pallet: 1, items: null }]);
  });

  it('vaciar otra tarima a mano la devuelve al reparto', () => {
    const selected = units.filter((u) => u.sku === 'C');
    expect(applyPalletSelection(1, selected, units)).toContainEqual({ pallet: 2, items: null });
  });
});
