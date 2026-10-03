/**
 * Qué hace Double Check con una foto del frente (idea-245, F1;
 * `docs/prds/pallet-box-inference.md` §4 y §6.3).
 *
 * Dos pasos, los dos puros:
 *
 * 1. **De qué tarima es** (`frontPallet`): la que tiene más cajas en común con
 *    lo que se lee. Si hay una sola con más, es ésa — caso A si todo lo leído
 *    ya estaba en ella, B si la foto trae cajas de otras —. Empate (C) o nada
 *    en común (D): `null`, y pregunta el picker.
 * 2. **Qué queda en ella** (`applyFront`): lo decide `palletTimeline`, el mismo
 *    motor de la línea de tiempo, con lo que había en cada tarima como hecho
 *    anterior y el frente como hecho nuevo. Ver no es quitar: lo que estaba y
 *    no se ve se queda, y sale como `missing` (el `?` que el picker contesta).
 *
 * Lo que devuelve se guarda con `applyPalletSelection` (`palletUnits.ts`), lo
 * mismo que guarda el lápiz: una tarima armada a mano, y la caja que se trae de
 * otra armada a mano se le quita a esa. Así una sola regla decide, venga de la
 * foto o del lápiz.
 */
import type { FrontBox } from './frontRead';
import type { PalletUnit } from './palletUnits';
import { palletTimeline, type TimelineFact } from './palletTimeline';

export type FrontCase = 'A' | 'B' | 'C' | 'D';

export interface FrontPallet {
  case: FrontCase;
  /** La tarima del frente, o `null` si el picker tiene que elegir (C, D). */
  pallet: number | null;
  /** En un empate, las tarimas empatadas. */
  candidates: number[];
}

const count = <T>(xs: readonly T[], key: (x: T) => string) => {
  const m = new Map<string, number>();
  for (const x of xs) m.set(key(x), (m.get(key(x)) ?? 0) + 1);
  return m;
};

/** Las cajas leídas que son de la orden (una caja de otro envío al fondo no cuenta). */
export function inOrder(seen: readonly FrontBox[], units: readonly PalletUnit[]): FrontBox[] {
  const skus = new Set(units.map((u) => u.sku));
  return seen.filter((b) => skus.has(b.sku));
}

export function frontPallet(seen: readonly FrontBox[], units: readonly PalletUnit[]): FrontPallet {
  const read = count(inOrder(seen, units), (b) => b.sku);
  const pallets = [...new Set(units.map((u) => u.fromPallet))];
  const common = pallets.map((p) => {
    const here = count(
      units.filter((u) => u.fromPallet === p),
      (u) => u.sku
    );
    let n = 0;
    for (const [sku, k] of read) n += Math.min(k, here.get(sku) ?? 0);
    return { p, n };
  });
  const best = Math.max(0, ...common.map((c) => c.n));
  if (best === 0) return { case: 'D', pallet: null, candidates: [] };
  const top = common.filter((c) => c.n === best).map((c) => c.p);
  if (top.length > 1) return { case: 'C', pallet: null, candidates: top.sort((a, b) => a - b) };
  const total = [...read.values()].reduce((a, b) => a + b, 0);
  return { case: best === total ? 'A' : 'B', pallet: top[0], candidates: [] };
}

export interface AppliedFront {
  /** Las cajas que quedan en la tarima del frente (para `applyPalletSelection`). */
  selected: PalletUnit[];
  /** Las que la foto trajo de otra tarima: «from #3». */
  moved: { sku: string; fromLabel: string }[];
  /** Las que estaban y no se ven: el `?` que contesta el picker. */
  missing: { sku: string; location: string | null }[];
  /** Leídas que no son de la orden. */
  notInOrder: string[];
}

export function applyFront(
  target: number,
  seen: readonly FrontBox[],
  units: readonly PalletUnit[]
): AppliedFront {
  const ours = inOrder(seen, units);
  const notInOrder = seen.filter((b) => !ours.includes(b)).map((b) => b.sku);

  // Lo que había en cada tarima, como hecho anterior; el frente, como hecho nuevo.
  const lines = [...count(units, (u) => `${u.sku}\u0000${u.location ?? ''}`).entries()].map(
    ([k, qty]) => {
      const [sku, location] = k.split('\u0000');
      return { sku, location: location || null, qty };
    }
  );
  const facts: TimelineFact[] = [];
  for (const p of new Set(units.map((u) => u.fromPallet))) {
    facts.push({
      kind: 'hand',
      t: 0,
      pallet: p,
      items: [
        ...count(
          units.filter((u) => u.fromPallet === p),
          (u) => u.sku
        ).entries(),
      ].map(([sku, qty]) => ({ sku, qty })),
    });
  }
  facts.push({
    kind: 'front',
    t: 1,
    pallet: target,
    seen: [...count(ours, (b) => b.sku).entries()].map(([sku, n]) => ({ sku, count: n })),
  });
  const placed = palletTimeline({ lines, facts, marks: [] });

  // De vuelta a cajas concretas: por SKU, primero las que ya estaban en la
  // tarima, después las de tarimas del motor y al final las armadas a mano.
  const want = count(
    placed.filter((u) => u.pallet === target),
    (u) => u.sku
  );
  const selected: PalletUnit[] = [];
  const moved: AppliedFront['moved'] = [];
  for (const [sku, k] of want) {
    const pool = units
      .filter((u) => u.sku === sku)
      .sort(
        (a, b) =>
          Number(b.fromPallet === target) - Number(a.fromPallet === target) ||
          Number(a.fromManual) - Number(b.fromManual)
      );
    for (const u of pool.slice(0, k)) {
      selected.push(u);
      if (u.fromPallet !== target) moved.push({ sku: u.sku, fromLabel: u.fromLabel });
    }
  }

  const seenHere = count(ours, (b) => b.sku);
  const missing: AppliedFront['missing'] = [];
  for (const u of units.filter((x) => x.fromPallet === target)) {
    const left = seenHere.get(u.sku) ?? 0;
    if (left > 0) seenHere.set(u.sku, left - 1);
    else missing.push({ sku: u.sku, location: u.location });
  }

  return { selected, moved, missing, notInOrder };
}
