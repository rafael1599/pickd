import { describe, expect, it } from 'vitest';
import { proposeSelection } from '../palletProposal';
import type { PalletUnit } from '../palletUnits';

const unit = (sku: string, pallet: number): PalletUnit => ({
  sku,
  location: 'ROW 1',
  itemName: null,
  isKids: sku.startsWith('07-'),
  fromPallet: pallet,
  fromManual: false,
  fromLabel: `#${pallet}`,
});

// Tres tarimas en orden de recogida: #1 A A B, #2 C D E, #3 F G.
const units = [
  unit('A', 1),
  unit('A', 1),
  unit('B', 1),
  unit('C', 2),
  unit('D', 2),
  unit('E', 2),
  unit('F', 3),
  unit('G', 3),
];

describe('proposeSelection', () => {
  it('de 3 a 5: las primeras de la tarima que sigue, después las últimas de la anterior', () => {
    const p = proposeSelection(units, 2, 5);
    expect(p.picked.map((i) => units[i].sku)).toEqual(['C', 'D', 'E', 'F', 'B']);
    expect(p.reasons).toEqual({ 6: 'next', 2: 'next' });
  });

  it('la foto manda: la G que vio en la tarima 2 va antes que la vecina', () => {
    const p = proposeSelection(units, 2, 4, ['C', 'D', 'E', 'G']);
    expect(p.picked.map((i) => units[i].sku)).toEqual(['C', 'D', 'E', 'G']);
    expect(p.reasons).toEqual({ 7: 'photo' });
  });

  it('de 3 a 2: se quita la última cargada, salvo que la foto la vio', () => {
    expect(proposeSelection(units, 2, 2).picked.map((i) => units[i].sku)).toEqual(['C', 'D']);
    const p = proposeSelection(units, 2, 2, ['E', 'D']);
    expect(p.picked.map((i) => units[i].sku)).toEqual(['D', 'E']);
    expect(p.reasons).toEqual({ 3: 'off' });
  });

  it('la misma cifra no propone nada', () => {
    expect(proposeSelection(units, 2, 3)).toEqual({ picked: [3, 4, 5], reasons: {} });
  });

  it('#881828: la de niño de 7 a 9 trae las dos últimas grandes de la tarima 1', () => {
    const order = [
      ...Array.from({ length: 12 }, (_, i) => unit(`03-${3900 + i}BK`, 1)),
      ...Array.from({ length: 7 }, (_, i) => unit(`07-${3740 + i}RD`, 2)),
    ];
    const p = proposeSelection(order, 2, 9);
    expect(p.picked.slice(7).map((i) => order[i].sku)).toEqual(['03-3911BK', '03-3910BK']);
  });
});
