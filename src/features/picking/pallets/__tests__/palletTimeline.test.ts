import { describe, expect, it } from 'vitest';
import {
  fixedPallets,
  loadTimes,
  MISTAP_MS,
  palletTimeline,
  type TimelineFact,
  type TimelineLine,
  type TimelineMark,
} from '../palletTimeline';

const L = (sku: string, qty = 1, location: string | null = 'ROW 1'): TimelineLine => ({
  sku,
  location,
  qty,
});
const where = (units: ReturnType<typeof palletTimeline>, sku: string) =>
  units.filter((u) => u.sku === sku).map((u) => u.pallet);
const check = (t: number, sku: string, extra: Partial<TimelineMark> = {}): TimelineMark => ({
  t,
  sku,
  location: 'ROW 1',
  kind: 'check',
  phase: 'pick',
  ...extra,
});

// Los casos llevan el número de la tabla §6.6 de docs/prds/pallet-box-inference.md.
describe('palletTimeline: manda el hecho más reciente', () => {
  it('caso 1: edita con el lápiz y después una foto dice otra cosa → gana la foto', () => {
    const facts: TimelineFact[] = [
      { kind: 'hand', t: 100, pallet: 2, items: [{ sku: 'A', qty: 1 }] },
      { kind: 'front', t: 200, pallet: 3, seen: [{ sku: 'A', count: 1 }] },
    ];
    const u = palletTimeline({ lines: [L('A')], facts, marks: [] });
    expect(u[0]).toMatchObject({ pallet: 3, source: 'photo', at: 200 });
  });

  it('caso 2: foto y después el lápiz → gana el lápiz', () => {
    const facts: TimelineFact[] = [
      { kind: 'front', t: 100, pallet: 3, seen: [{ sku: 'A', count: 1 }] },
      { kind: 'hand', t: 200, pallet: 2, items: [{ sku: 'A', qty: 1 }] },
    ];
    expect(palletTimeline({ lines: [L('A')], facts, marks: [] })[0]).toMatchObject({
      pallet: 2,
      source: 'hand',
    });
  });

  it('caso 3: la hora del frente es la de la cámara; un lápiz guardado mientras se leía es más nuevo', () => {
    const facts: TimelineFact[] = [
      { kind: 'hand', t: 150, pallet: 2, items: [{ sku: 'A', qty: 1 }] },
      { kind: 'front', t: 140, pallet: 3, seen: [{ sku: 'A', count: 1 }] }, // tomada a las 140, leída después
    ];
    expect(palletTimeline({ lines: [L('A')], facts, marks: [] })[0].pallet).toBe(2);
  });

  it('caso 4 y «ver no es quitar»: un frente nuevo que no ve una caja no la saca', () => {
    const facts: TimelineFact[] = [
      {
        kind: 'front',
        t: 100,
        pallet: 1,
        seen: [
          { sku: 'A', count: 1 },
          { sku: 'B', count: 1 },
        ],
      },
      { kind: 'front', t: 200, pallet: 1, seen: [{ sku: 'A', count: 1 }] },
    ];
    const u = palletTimeline({ lines: [L('A'), L('B')], facts, marks: [] });
    expect(where(u, 'B')).toEqual([1]);
    expect(u.find((x) => x.sku === 'B')!.at).toBe(100);
  });

  it('caso 5: la misma caja vista en dos tarimas — con 2 unidades, una en cada una; con 1, el frente más nuevo', () => {
    const facts: TimelineFact[] = [
      { kind: 'front', t: 100, pallet: 1, seen: [{ sku: 'A', count: 1 }] },
      { kind: 'front', t: 200, pallet: 2, seen: [{ sku: 'A', count: 1 }] },
    ];
    expect(where(palletTimeline({ lines: [L('A', 2)], facts, marks: [] }), 'A').sort()).toEqual([
      1, 2,
    ]);
    expect(where(palletTimeline({ lines: [L('A', 1)], facts, marks: [] }), 'A')).toEqual([2]);
  });

  it('caso 6: varias unidades del mismo SKU se cuentan, no se identifican', () => {
    const facts: TimelineFact[] = [
      { kind: 'hand', t: 100, pallet: 1, items: [{ sku: 'A', qty: 2 }] },
      { kind: 'front', t: 200, pallet: 2, seen: [{ sku: 'A', count: 1 }] },
    ];
    // La de la foto sale de la que nadie había ubicado, no de la tarima 1.
    expect(where(palletTimeline({ lines: [L('A', 3)], facts, marks: [] }), 'A')).toEqual([1, 1, 2]);
  });

  it('caso 9/10: un frente puede nombrar una tarima nueva, y una tarima que se vacía no se fija', () => {
    const facts: TimelineFact[] = [
      { kind: 'hand', t: 100, pallet: 1, items: [{ sku: 'A', qty: 1 }] },
      { kind: 'front', t: 200, pallet: 4, seen: [{ sku: 'A', count: 1 }] },
    ];
    const fixed = fixedPallets(palletTimeline({ lines: [L('A')], facts, marks: [] }));
    expect(fixed).toEqual([{ pallet: 4, items: [{ sku: 'A', location: 'ROW 1', qty: 1 }] }]);
  });

  it('caso 11: una desmarca del picker posterior a la foto saca la caja; otra foto la devuelve', () => {
    const front = (t: number): TimelineFact => ({
      kind: 'front',
      t,
      pallet: 1,
      seen: [{ sku: 'A', count: 1 }],
    });
    // Horas reales (ms): a menos de 5 s la desmarca sería un dedo equivocado.
    const marks = [check(50_000, 'A'), check(300_000, 'A', { kind: 'uncheck' })];
    expect(
      palletTimeline({ lines: [L('A')], facts: [front(100_000)], marks })[0].pallet
    ).toBeNull();
    expect(
      palletTimeline({ lines: [L('A')], facts: [front(100_000), front(400_000)], marks })[0].pallet
    ).toBe(1);
  });

  it('caso 12: lo que ya no está en la orden no se ubica', () => {
    const facts: TimelineFact[] = [
      { kind: 'front', t: 100, pallet: 1, seen: [{ sku: 'GONE', count: 1 }] },
    ];
    expect(palletTimeline({ lines: [L('A')], facts, marks: [] }).map((u) => u.sku)).toEqual(['A']);
  });

  it('✓ pone una caja que no se veía; ✗ la devuelve al reparto', () => {
    const present: TimelineFact = { kind: 'present', t: 100, pallet: 2, sku: 'A' };
    const absent: TimelineFact = { kind: 'absent', t: 200, pallet: 2, sku: 'A' };
    expect(palletTimeline({ lines: [L('A')], facts: [present], marks: [] })[0]).toMatchObject({
      pallet: 2,
      source: 'answer',
    });
    expect(
      palletTimeline({ lines: [L('A')], facts: [present, absent], marks: [] })[0]
    ).toMatchObject({ pallet: null, source: 'answer' });
  });

  it('lo que el lápiz desmarca vuelve al reparto, y las marcas no lo vuelven a poner', () => {
    const facts: TimelineFact[] = [
      {
        kind: 'hand',
        t: 100,
        pallet: 1,
        items: [
          { sku: 'A', qty: 1 },
          { sku: 'B', qty: 1 },
        ],
      },
      { kind: 'hand', t: 200, pallet: 1, items: [{ sku: 'A', qty: 1 }] },
      { kind: 'front', t: 300, pallet: 1, seen: [{ sku: 'A', count: 1 }] },
    ];
    const u = palletTimeline({ lines: [L('A'), L('B')], facts, marks: [check(250, 'B')] });
    expect(where(u, 'B')).toEqual([null]);
  });
});

describe('las marcas: orden de carga y relleno', () => {
  it('una caja sin hecho que el picker cargó antes de un frente va a la tarima de ese frente', () => {
    const facts: TimelineFact[] = [
      { kind: 'front', t: 100, pallet: 1, seen: [{ sku: 'A', count: 1 }] },
      { kind: 'front', t: 300, pallet: 2, seen: [{ sku: 'C', count: 1 }] },
    ];
    const u = palletTimeline({ lines: [L('A'), L('B'), L('C')], facts, marks: [check(200, 'B')] });
    expect(u.find((x) => x.sku === 'B')).toMatchObject({
      pallet: 2,
      source: 'picked',
      loadedAt: 200,
    });
  });

  it('sólo cuentan las del picker; vale la última; un dedo equivocado no cuenta; lo masivo no dice orden', () => {
    const { loaded } = loadTimes([
      check(10, 'A'),
      check(20, 'A', { kind: 'uncheck' }),
      check(30, 'A'), // vuelta a marcar: vale esta
      check(40, 'B'),
      check(40 + MISTAP_MS - 1, 'B', { kind: 'uncheck' }), // dedo equivocado: B queda sin hora
      check(50, 'C', { phase: 'check' }), // quien verifica
      check(60, 'D', { bulk: true }), // Select all
    ]);
    const k = (sku: string) => `${sku}\u0000ROW 1`;
    expect(loaded.get(k('A'))).toBe(30);
    expect(loaded.has(k('B'))).toBe(false);
    expect(loaded.has(k('C'))).toBe(false);
    expect(loaded.has(k('D'))).toBe(false);
  });

  it('el hermano de variante hereda la hora de la marca', () => {
    const base = (s: string) => s.replace(/^(\d{2}-\d{4}[A-Z]{2})[A-Z]$/, '$1');
    const u = palletTimeline({
      lines: [L('03-3768BL')],
      facts: [],
      marks: [check(70, '03-3768BLD')],
      boxKey: base,
    });
    expect(u[0].loadedAt).toBe(70);
  });
});
