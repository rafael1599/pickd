import { describe, expect, it } from 'vitest';
import { lineSignature, shipCheck, shipCheckApplies, type ShipCheckInput } from '../shipCheck';

const base: ShipCheckInput = {
  lines: [
    { sku: '03-3769BL', location: 'ROW 41', pickingQty: 2 },
    { sku: '03-4537GY', location: 'ROW 2', pickingQty: 1 },
  ],
  verifiedKeys: ['1-03-3769BL-ROW 41', '1-03-4537GY-ROW 2'],
  photoAlerts: [],
  photos: 1,
  pallets: 1,
  isFedex: false,
  reopenCount: 0,
  sdShared: [],
  duplicates: [],
  registered: () => true,
};

describe('shipCheck', () => {
  it('una orden limpia no dice nada', () => {
    expect(shipCheck(base)).toEqual([]);
  });

  it('#881543: completada sin verificar ninguna línea', () => {
    expect(shipCheck({ ...base, verifiedKeys: [] })).toEqual([
      { level: 'red', text: 'NOT VERIFIED 2 of 2 lines · 03-3769BL, 03-4537GY' },
    ]);
  });

  it('S/D #78 con el mismo SKU que las nuevas', () => {
    const out = shipCheck({
      ...base,
      sdShared: [{ sku: '03-3769BL', sdNumber: 78, location: 'ROW 12 H' }],
    });
    expect(out).toEqual([
      { level: 'red', text: '03-3769BL HAS AN S/D #78 IN ROW 12 H · ship a new one' },
    ]);
  });

  it('rojo antes que ámbar: alerta de foto, sin catálogo, menos fotos, duplicada, LOW STOCK, reabierta', () => {
    const out = shipCheck({
      ...base,
      lines: [
        ...base.lines,
        {
          sku: '01-0508',
          location: null,
          pickingQty: 1,
          sku_not_found: true,
          insufficient_stock: true,
        },
      ],
      verifiedKeys: [...base.verifiedKeys, '1-01-0508-null'],
      photoAlerts: ['WRONG PICK? 03-4547MN ×2 · order asks 03-4537GY'],
      photos: 1,
      pallets: 2,
      duplicates: ['881551'],
      reopenCount: 2,
      registered: (s) => s !== '01-0508',
    });
    expect(out.map((i) => `${i.level} ${i.text}`)).toEqual([
      'red WRONG PICK? 03-4547MN ×2 · order asks 03-4537GY',
      'red NOT IN CATALOG 01-0508',
      'amber 2 PALLETS, 1 PHOTO',
      'amber POSSIBLE DUPLICATE of #881551 · same customer, same lines',
      'amber LOW STOCK 01-0508',
      'amber REOPENED ×2 · photos may be from before the change',
    ]);
  });

  it('sin foto avisa salvo FedEx', () => {
    expect(shipCheck({ ...base, photos: 0 })).toEqual([
      { level: 'amber', text: 'NO PHOTO of the pallets' },
    ]);
    expect(shipCheck({ ...base, photos: 0, isFedex: true })).toEqual([]);
  });
});

describe('lineSignature', () => {
  it('el mismo conjunto de líneas, en cualquier orden', () => {
    expect(
      lineSignature([
        { sku: 'B', pickingQty: 1 },
        { sku: 'A', pickingQty: 2 },
      ])
    ).toBe(
      lineSignature([
        { sku: 'A', pickingQty: 2 },
        { sku: 'B', pickingQty: 1 },
      ])
    );
  });
});

describe('shipCheckApplies', () => {
  const applies = (statuses: string[], photos = 0) => shipCheckApplies({ statuses, photos });

  it('active sin foto: todavía se pickea, ningún aviso', () => {
    expect(applies(['active'])).toBe(false);
  });

  it('active con foto: aplica', () => {
    expect(applies(['active'], 1)).toBe(true);
  });

  it('pasó a double check: aplica', () => {
    expect(applies(['ready_to_double_check'])).toBe(true);
    expect(applies(['double_checking'])).toBe(true);
    expect(applies(['needs_correction'])).toBe(true);
  });

  it('completed y reopened: aplica', () => {
    expect(applies(['completed'])).toBe(true);
    expect(applies(['reopened'])).toBe(true);
  });

  it('cancelled no se envía: no aplica, ni con foto', () => {
    expect(applies(['cancelled'])).toBe(false);
    expect(applies(['cancelled'], 2)).toBe(false);
  });

  it('combinada: basta con una hermana en double check; las canceladas no cuentan', () => {
    expect(applies(['active', 'ready_to_double_check'])).toBe(true);
    expect(applies(['active', 'active'])).toBe(false);
    expect(applies(['active', 'cancelled'])).toBe(false);
    expect(applies(['cancelled', 'completed'])).toBe(true);
  });

  it('sin orden: no aplica', () => {
    expect(applies([])).toBe(false);
  });
});
