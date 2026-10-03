/**
 * En qué tarima está cada caja, según lo que se vio y se dijo, en orden de
 * tiempo (idea-245, F1; `docs/prds/pallet-box-inference.md` §6.3–§6.6).
 *
 * Rafael, 2 oct 2026: «debe haber un orden de tiempo; si el usuario primero
 * edita y después toma la foto y la foto dice algo diferente de la edición, se
 * actualiza». No hay una señal que gane siempre: **para cada caja vale el hecho
 * más reciente**. Tres frenos para que el tiempo no haga daño:
 *
 * - **Ver no es quitar.** Un frente pone en su tarima las cajas que ve; las que
 *   no ve no salen de ninguna (pueden estar tapadas por el strap).
 * - **Una foto sin tarima segura no es un hecho**: quien llama sólo pasa
 *   frentes con tarima (los de caso C/D esperan la respuesta del picker).
 * - **Las aproximaciones rellenan, no pisan**: las marcas del picker sólo
 *   ubican cajas de las que nadie vio ni dijo nada, y el plan del motor
 *   (`planPallets`) reparte lo que quede — fuera de aquí.
 *
 * Las cajas se cuentan por SKU, no por identidad: todas las unidades de un SKU
 * llevan la misma etiqueta (§6.6, caso 6). **La orden manda sobre todo**: lo
 * que ya no está en la orden no se ubica (caso 12).
 *
 * Las marcas se leen con las reglas de §6.3.8: sólo las del picker (`pick`),
 * vale la última, una marca deshecha en menos de {@link MISTAP_MS} es un dedo
 * equivocado, y lo masivo (Select all / Clear) no dice nada del orden.
 *
 * Puro: las horas llegan ya decididas (`t`, ms) — quien llama elige cuál vale
 * para cada hecho (§6.7: la de la cámara para un frente).
 */

/** Una marca deshecha en menos de esto no cuenta: fue un dedo equivocado (§6.3.8). */
export const MISTAP_MS = 5000;

export type TimelineFact =
  /** Un frente con tarima segura: cuántas de cada SKU se ven en ella. */
  | { kind: 'front'; t: number; pallet: number; seen: { sku: string; count: number }[] }
  /** Una edición con el lápiz: el contenido completo de esa tarima. */
  | { kind: 'hand'; t: number; pallet: number; items: { sku: string; qty: number }[] }
  /** El picker dijo ✓ «sí está» a una caja que no se veía. */
  | { kind: 'present'; t: number; pallet: number; sku: string }
  /** El picker dijo ✗ «no está». */
  | { kind: 'absent'; t: number; pallet: number; sku: string };

export interface TimelineMark {
  t: number;
  sku: string;
  location: string | null;
  kind: 'check' | 'uncheck';
  /** `pick` = el picker antes de Ready to DC; sólo esas dicen el orden de carga. */
  phase: 'pick' | 'check' | null;
  bulk?: boolean;
}

export interface TimelineLine {
  sku: string;
  location: string | null;
  qty: number;
}

export type UnitSource = 'photo' | 'hand' | 'answer' | 'picked';

export interface TimelineUnit {
  sku: string;
  location: string | null;
  /** `null` = nadie dijo dónde: la reparte el motor. */
  pallet: number | null;
  source: UnitSource | null;
  /** Hora del hecho que la puso ahí. */
  at: number | null;
  /** Hora de la última marca del picker de su línea: el orden de carga. */
  loadedAt: number | null;
}

export interface TimelineInput {
  lines: readonly TimelineLine[];
  facts: readonly TimelineFact[];
  marks: readonly TimelineMark[];
  /**
   * La misma caja con otro nombre: el hermano de variante (BL/BLD) hereda la
   * hora de la marca (§6.3.8). Por defecto, el SKU tal cual.
   */
  boxKey?: (sku: string) => string;
}

const lineKey = (sku: string, location: string | null) => `${sku}\u0000${location ?? ''}`;

/**
 * Hora de carga de cada línea: su última marca del picker que sobrevive. Una
 * marca deshecha en menos de {@link MISTAP_MS} desaparece con su desmarca; lo
 * masivo no cuenta; una línea que termina desmarcada no tiene hora.
 */
export function loadTimes(
  marks: readonly TimelineMark[],
  boxKey: (sku: string) => string = (s) => s
): { loaded: Map<string, number>; unloaded: Map<string, number> } {
  const byLine = new Map<string, TimelineMark[]>();
  for (const m of marks) {
    if (m.phase !== 'pick' || m.bulk) continue;
    const k = lineKey(boxKey(m.sku), m.location);
    (byLine.get(k) ?? byLine.set(k, []).get(k)!).push(m);
  }
  const out = new Map<string, number>();
  const unloaded = new Map<string, number>();
  for (const [k, ms] of byLine) {
    const sorted = [...ms].sort((a, b) => a.t - b.t);
    const kept: TimelineMark[] = [];
    for (const m of sorted) {
      const prev = kept[kept.length - 1];
      if (m.kind === 'uncheck' && prev?.kind === 'check' && m.t - prev.t < MISTAP_MS) {
        kept.pop();
        continue;
      }
      kept.push(m);
    }
    const last = kept[kept.length - 1];
    if (!last) continue;
    if (last.kind !== 'check') {
      unloaded.set(k, last.t);
      continue;
    }
    // La hora de la última marca de una racha de marcas (desmarcar y volver a
    // marcar mueve la caja al final de la fila: vale la última).
    out.set(k, last.t);
  }
  return { loaded: out, unloaded };
}

export function palletTimeline(input: TimelineInput): TimelineUnit[] {
  const key = input.boxKey ?? ((s: string) => s);
  const { loaded, unloaded } = loadTimes(input.marks, key);

  const units: TimelineUnit[] = [];
  for (const line of input.lines) {
    for (let i = 0; i < Math.max(0, Math.floor(line.qty)); i += 1) {
      units.push({
        sku: line.sku,
        location: line.location,
        pallet: null,
        source: null,
        at: null,
        loadedAt: loaded.get(lineKey(key(line.sku), line.location)) ?? null,
      });
    }
  }

  const ofSku = (sku: string) => units.filter((u) => key(u.sku) === key(sku));

  /**
   * Pone una caja más de `sku` en `pallet`: de donde menos se sabía. Primero
   * las que nadie ubicó, después la que lleva más tiempo sin un hecho nuevo.
   * Nunca la que acaba de poner el mismo hecho.
   */
  const pull = (
    sku: string,
    pallet: number,
    t: number,
    source: UnitSource,
    taken: Set<TimelineUnit>
  ) => {
    const candidates = ofSku(sku)
      .filter((u) => u.pallet !== pallet && !taken.has(u))
      .sort((a, b) => (a.at ?? -Infinity) - (b.at ?? -Infinity));
    const u = candidates[0];
    if (!u) return false;
    Object.assign(u, { pallet, source, at: t });
    taken.add(u);
    return true;
  };

  const facts = [...input.facts].sort((a, b) => a.t - b.t);
  for (const f of facts) {
    if (f.kind === 'front') {
      for (const { sku, count } of f.seen) {
        const here = ofSku(sku).filter((u) => u.pallet === f.pallet);
        // Lo que ya estaba aquí queda confirmado por la foto, que es más nueva.
        const taken = new Set<TimelineUnit>();
        for (const u of here.slice(0, count)) {
          Object.assign(u, { source: 'photo', at: f.t });
          taken.add(u);
        }
        for (let i = here.length; i < count; i += 1) pull(sku, f.pallet, f.t, 'photo', taken);
      }
    } else if (f.kind === 'hand') {
      // El lápiz dice el contenido completo de la tarima.
      const want = new Map<string, number>();
      for (const it of f.items) want.set(key(it.sku), (want.get(key(it.sku)) ?? 0) + it.qty);
      const taken = new Set<TimelineUnit>();
      for (const u of units.filter((x) => x.pallet === f.pallet)) {
        const left = want.get(key(u.sku)) ?? 0;
        if (left > 0) {
          want.set(key(u.sku), left - 1);
          Object.assign(u, { source: 'hand', at: f.t });
          taken.add(u);
        } else {
          // Lo desmarcado en el lápiz vuelve al reparto.
          Object.assign(u, { pallet: null, source: 'hand', at: f.t });
        }
      }
      for (const [sku, left] of want) {
        for (let i = 0; i < left; i += 1) pull(sku, f.pallet, f.t, 'hand', taken);
      }
    } else if (f.kind === 'present') {
      if (!ofSku(f.sku).some((u) => u.pallet === f.pallet)) {
        pull(f.sku, f.pallet, f.t, 'answer', new Set());
      }
    } else {
      const u = ofSku(f.sku).find((x) => x.pallet === f.pallet);
      if (u) Object.assign(u, { pallet: null, source: 'answer', at: f.t });
    }
  }

  // Una desmarca del picker más nueva que el hecho que ubicó la caja la saca
  // de su tarima: dice que no la cargó (§6.6, caso 11). Un frente posterior que
  // la vuelva a ver la devuelve, porque entonces el frente es lo más nuevo.
  for (const u of units) {
    const off = unloaded.get(lineKey(key(u.sku), u.location));
    if (off == null || u.pallet == null || (u.at ?? -Infinity) > off) continue;
    Object.assign(u, { pallet: null, source: null, at: off });
  }

  // Las marcas rellenan: una caja sin hecho cuyo picker la cargó antes de un
  // frente va a la tarima de ese frente (el bloque de marcas, §6.3.5).
  const fronts = facts.filter(
    (f): f is Extract<TimelineFact, { kind: 'front' }> => f.kind === 'front'
  );
  for (const u of units) {
    if (u.pallet != null || u.source != null || u.loadedAt == null) continue;
    const closing = fronts.find((f) => f.t >= u.loadedAt!);
    if (closing) Object.assign(u, { pallet: closing.pallet, source: 'picked', at: u.loadedAt });
  }

  return units;
}

/** Lo que el timeline fija, en la forma que `planPallets` entiende como tarimas armadas. */
export function fixedPallets(
  units: readonly TimelineUnit[]
): { pallet: number; items: { sku: string; location: string | null; qty: number }[] }[] {
  const byPallet = new Map<
    number,
    Map<string, { sku: string; location: string | null; qty: number }>
  >();
  for (const u of units) {
    if (u.pallet == null) continue;
    const m = byPallet.get(u.pallet) ?? byPallet.set(u.pallet, new Map()).get(u.pallet)!;
    const k = lineKey(u.sku, u.location);
    const it = m.get(k) ?? m.set(k, { sku: u.sku, location: u.location, qty: 0 }).get(k)!;
    it.qty += 1;
  }
  return [...byPallet.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([pallet, m]) => ({ pallet, items: [...m.values()] }));
}
