import { describe, expect, it } from 'vitest';
import type { FrontBox } from '../frontRead';
import { applyPalletSelection, type PalletUnit } from '../palletUnits';
import { applyFront, frontPallet } from '../frontApply';

const U = (sku: string, fromPallet: number, fromManual = false): PalletUnit => ({
  sku,
  location: 'ROW 1',
  itemName: null,
  isKids: false,
  fromPallet,
  fromManual,
  fromLabel: `#${fromPallet}`,
});
const B = (sku: string, level = 0, pos = 0): FrontBox => ({
  sku,
  upright: true,
  x_in: pos * 8.5,
  y_in: level * 30,
  level,
  pos,
});

// Tarima 1: A, A, B, C · tarima 2: D, E, F, G
const units = [
  U('A', 1),
  U('A', 1),
  U('B', 1),
  U('C', 1),
  U('D', 2),
  U('E', 2),
  U('F', 2),
  U('G', 2),
];

describe('frontPallet', () => {
  it('caso A: todo lo leído está en una tarima', () => {
    expect(frontPallet([B('A'), B('A'), B('B'), B('C')], units)).toEqual({
      case: 'A',
      pallet: 1,
      candidates: [],
    });
  });
  it('caso B: la mayoría en una, alguna de otra', () => {
    expect(frontPallet([B('A'), B('B'), B('C'), B('D')], units)).toMatchObject({
      case: 'B',
      pallet: 1,
    });
  });
  it('caso C: empate → pregunta', () => {
    expect(frontPallet([B('A'), B('B'), B('D'), B('E')], units)).toEqual({
      case: 'C',
      pallet: null,
      candidates: [1, 2],
    });
  });
  it('caso D: nada en común (otro envío) → pregunta', () => {
    expect(frontPallet([B('X'), B('Y'), B('Z'), B('W')], units)).toMatchObject({
      case: 'D',
      pallet: null,
    });
  });
});

describe('applyFront', () => {
  it('trae la caja de otra tarima (from #2), conserva lo que no se ve y lo marca con ?', () => {
    const r = applyFront(1, [B('A'), B('B'), B('D')], units);
    expect(r.selected.map((u) => u.sku).sort()).toEqual(['A', 'A', 'B', 'C', 'D']);
    expect(r.moved).toEqual([{ sku: 'D', fromLabel: '#2' }]);
    expect(r.missing.map((m) => m.sku).sort()).toEqual(['A', 'C']);
    expect(r.notInOrder).toEqual([]);
  });

  it('lo leído que no es de la orden no entra y se dice', () => {
    const r = applyFront(1, [B('A'), B('ZZ')], units);
    expect(r.notInOrder).toEqual(['ZZ']);
    expect(r.selected.map((u) => u.sku)).not.toContain('ZZ');
  });

  it('se guarda igual que el lápiz: la caja traída de una tarima armada a mano se le quita a esa', () => {
    const manual = [U('A', 1), U('B', 1), U('D', 2, true), U('E', 2, true)];
    const r = applyFront(1, [B('A'), B('B'), B('D')], manual);
    const writes = applyPalletSelection(1, r.selected, manual);
    expect(writes).toEqual([
      {
        pallet: 1,
        items: [
          { sku: 'A', location: 'ROW 1', qty: 1 },
          { sku: 'B', location: 'ROW 1', qty: 1 },
          { sku: 'D', location: 'ROW 1', qty: 1 },
        ],
      },
      { pallet: 2, items: [{ sku: 'E', location: 'ROW 1', qty: 1 }] },
    ]);
  });

  it('de una tarima del motor se toma antes que de una armada a mano', () => {
    const mixed = [U('A', 1), U('D', 2, true), U('D', 3, false)];
    const r = applyFront(1, [B('A'), B('D')], mixed);
    expect(r.moved).toEqual([{ sku: 'D', fromLabel: '#3' }]);
  });
});
