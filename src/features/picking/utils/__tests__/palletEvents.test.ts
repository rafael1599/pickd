import { describe, expect, it } from 'vitest';
import { bulkMarkEvents, editEvents, markEvent, markKey, type EventContext } from '../palletEvents';

const ctx = (): EventContext => {
  let n = 0;
  return {
    newId: () => `id-${++n}`,
    now: () => '2026-10-03T20:00:00.000Z',
    device: 'dev-1',
    listId: 'list-open',
  };
};

describe('markEvent', () => {
  it('una marca del picker: tarima del carrito, línea y fase', () => {
    const e = markEvent({ sku: '03-4611BK', location: 'ROW 8' }, 3, true, 'pick', ctx());
    expect(e).toMatchObject({
      kind: 'check',
      phase: 'pick',
      sku: '03-4611BK',
      location: 'ROW 8',
      cart_pallet: 3,
      list_id: 'list-open',
      device: 'dev-1',
      payload: {},
    });
  });

  it('en una combinada, la orden de la línea, no la abierta', () => {
    const e = markEvent(
      { sku: 'A', location: 'ROW 1', source_list_id: 'sister' },
      '1',
      false,
      'check',
      ctx()
    );
    expect(e.list_id).toBe('sister');
    expect(e.kind).toBe('uncheck');
    expect(e.cart_pallet).toBe(1);
  });
});

describe('bulkMarkEvents', () => {
  const lines = [
    { sku: '03-3987-GY', location: 'ROW 2' },
    { sku: '07-3744BL', location: 'ROW 30' },
  ];

  it('Select all: sólo lo que se encendió, marcado como masivo', () => {
    const before = new Set([markKey(1, lines[0])]);
    const after = new Set([markKey(1, lines[0]), markKey(2, lines[1])]);
    const out = bulkMarkEvents(before, after, lines, 'pick', ctx());
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      kind: 'check',
      sku: '07-3744BL',
      cart_pallet: 2,
      payload: { bulk: true },
    });
  });

  it('Clear: cada llave apagada; un SKU con guiones se atribuye entero', () => {
    const before = new Set([markKey(1, lines[0]), markKey(2, lines[1])]);
    const out = bulkMarkEvents(before, new Set(), lines, 'check', ctx());
    expect(out.map((e) => [e.kind, e.sku, e.cart_pallet])).toEqual([
      ['uncheck', '03-3987-GY', 1],
      ['uncheck', '07-3744BL', 2],
    ]);
  });

  it('una llave que no está en el carrito no se inventa', () => {
    const out = bulkMarkEvents(new Set(), new Set(['1-ZZ-ROW 9']), lines, 'pick', ctx());
    expect(out).toEqual([]);
  });
});

describe('editEvents', () => {
  const base = { length_in: null, width_in: null, height_in: null, units: 0 };

  it('un evento por campo de contenido que cambió en una tarima tocada', () => {
    const before = [{ ...base, pallet: 2, bikes: 8 }];
    const after = [
      { ...base, pallet: 2, bikes: 7, items: [{ sku: 'A', location: 'ROW 1', qty: 1 }] },
    ];
    const out = editEvents(before, after, new Set([2]), ctx());
    expect(out.map((e) => e.payload)).toEqual([
      { field: 'items', from: null, to: [{ sku: 'A', location: 'ROW 1', qty: 1 }] },
      { field: 'bikes', from: 8, to: 7 },
    ]);
    expect(out[0]).toMatchObject({ kind: 'edit', pallet: 2, phase: null, list_id: 'list-open' });
  });

  it('la cinta no es una edición del contenido, y lo no tocado aquí no cuenta', () => {
    const before = [
      { ...base, pallet: 1 },
      { ...base, pallet: 3, bikes: 4 },
    ];
    const after = [
      { ...base, pallet: 1, height_in: 71 },
      { ...base, pallet: 3, bikes: 5 },
    ];
    expect(editEvents(before, after, new Set([1]), ctx())).toEqual([]);
  });

  it('deshacer una tarima armada a mano deja su evento', () => {
    const before = [{ ...base, pallet: 4, items: [{ sku: 'A', location: 'ROW 1', qty: 2 }] }];
    const out = editEvents(before, [], new Set([4]), ctx());
    expect(out).toHaveLength(1);
    expect(out[0].payload).toMatchObject({ field: 'items', to: null });
  });
});
