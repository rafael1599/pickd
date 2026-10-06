import { describe, expect, it } from 'vitest';
import { frontSummary, photoAlerts } from '../postProcess';
import type { PalletUnit } from '../../pallets/palletUnits';
import type { ShadowBox } from '../../utils/dcvShadow';

describe('photoAlerts', () => {
  it('#881828: 2 × 03-4547MN es un error de recogida de 03-4537GY', () => {
    const alerts = photoAlerts(
      [
        { sku: null },
        { sku: '03-4547MN' },
        { sku: '03-4547MN' },
        { sku: '03-3927BK' },
        { sku: 'CONFLICTO: 03-3922BL ≠ 15-3002' },
      ],
      [
        { sku: '03-4537GY', qty: 2 },
        { sku: '03-3927BK', qty: 1 },
        { sku: '03-3922BL', qty: 1 },
      ]
    );
    expect(alerts).toEqual([
      {
        kind: 'wrong_pick',
        sku: '03-4547MN',
        count: 2,
        orderSku: '03-4537GY',
        positions: [5, 7, 8],
      },
    ]);
  });

  it('lo que no es de la orden ni se parece a nada: not_in_order', () => {
    expect(photoAlerts([{ sku: '06-4438BK' }], [{ sku: '03-4537GY', qty: 1 }])).toEqual([
      { kind: 'not_in_order', sku: '06-4438BK', count: 1 },
    ]);
  });

  it('la lectura resuelta contra la orden manda sobre la cruda', () => {
    expect(
      photoAlerts([{ sku: '03-4537G', resolved_sku: '03-4537GY' }], [{ sku: '03-4537GY', qty: 1 }])
    ).toEqual([]);
  });

  it('#881833: 2 × 07-3746PU cuando la orden pide una, y falta la 07-3745WH parecida', () => {
    const lines = [
      { sku: '07-3744BL', qty: 1 },
      { sku: '07-3745WH', qty: 1 },
      { sku: '07-3746PU', qty: 1 },
    ];
    expect(
      photoAlerts([{ sku: '07-3746PU' }, { sku: '07-3744BL' }, { sku: '07-3746PU' }], lines)
    ).toEqual([
      {
        kind: 'wrong_pick',
        sku: '07-3746PU',
        count: 2,
        orderSku: '07-3745WH',
        positions: [6, 7, 8],
        ordered: 1,
      },
    ]);
  });

  it('sobra uno y no falta nada parecido: too_many', () => {
    expect(
      photoAlerts([{ sku: '03-3922BL' }, { sku: '03-3922BL' }], [{ sku: '03-3922BL', qty: 1 }])
    ).toEqual([{ kind: 'too_many', sku: '03-3922BL', count: 2, ordered: 1 }]);
  });

  it('una foto que no ve todo no es una alerta', () => {
    expect(photoAlerts([{ sku: '03-3922BL' }], [{ sku: '03-3922BL', qty: 3 }])).toEqual([]);
  });
});

describe('frontSummary', () => {
  const unit = (sku: string, pallet: number): PalletUnit => ({
    sku,
    location: 'ROW 1',
    itemName: null,
    isKids: false,
    fromPallet: pallet,
    fromManual: false,
    fromLabel: `#${pallet}`,
  });
  // Cuatro etiquetas derechas, en fila, 10 px de lado corto.
  const box = (sku: string, x: number): ShadowBox =>
    ({
      sku,
      corners: [
        [x, 100],
        [x + 10, 100],
        [x + 10, 130],
        [x, 130],
      ],
    }) as unknown as ShadowBox;

  it('una foto con ≥ 4 etiquetas es un frente de la tarima que más tiene en común', () => {
    const snapshot = [unit('A', 1), unit('B', 1), unit('C', 1), unit('D', 1), unit('E', 2)];
    const s = frontSummary([box('A', 0), box('B', 40), box('C', 80), box('D', 120)], snapshot);
    expect(s?.case).toBe('A');
    expect(s?.pallet).toBe(1);
    expect(s?.boxes).toHaveLength(4);
  });

  it('con menos de 4, no es un frente', () => {
    expect(frontSummary([box('A', 0)], [unit('A', 1)])).toBeNull();
  });
});
