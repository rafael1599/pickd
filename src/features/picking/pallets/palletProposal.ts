/**
 * Cambiar cuántas bicis lleva una tarima es elegir **cuáles** (Rafael, 5 oct
 * 2026): «si de 8 quiero pasar a 10 se me deben aparecer las 2 extras
 * seleccionadas como en el menú de editar, para elegir cuál más o desmarcar las
 * que no quiero, intentando hacer coincidir las imágenes con lo que se recogió».
 *
 * Así que la cifra ya no se guarda sola: abre el lápiz (`PalletBuilderModal`)
 * con una propuesta marcada, y lo que se guarda es la tarima armada. Esta
 * función hace la propuesta, con lo que se sabe en la pantalla:
 *
 * 1. **La foto del frente** de esa tarima: una caja que la foto vio ahí y está
 *    en otra tarima es la primera que se trae; una que está ahí y la foto vio
 *    es la última que se quita.
 * 2. **El orden de recogida**: las tarimas se llenan en ese orden, así que lo
 *    que sobra o falta está en la frontera — las primeras de la tarima que
 *    sigue, después las últimas de la anterior. Para quitar, la última que se
 *    cargó.
 *
 * Puro: índices sobre `units` (`palletUnits`, en orden de tarima y de recogida).
 */
import type { PalletUnit } from './palletUnits';

/** Por qué una caja sale propuesta: la vio la foto, es la vecina, o sobra. */
export type ProposalReason = 'photo' | 'next' | 'off';

export interface PalletProposal {
  /** Índices de `units` marcados para la tarima. */
  picked: number[];
  /** Sólo los que la propuesta cambió respecto a como estaba. */
  reasons: Record<number, ProposalReason>;
}

export function proposeSelection(
  units: readonly PalletUnit[],
  target: number,
  count: number,
  seen: readonly string[] = []
): PalletProposal {
  const here = units.flatMap((u, i) => (u.fromPallet === target ? [i] : []));
  const want = Math.max(0, Math.floor(count));
  const reasons: Record<number, ProposalReason> = {};

  // Lo que la foto vio en esta tarima, descontando lo que ya está en ella.
  const seenLeft = new Map<string, number>();
  for (const sku of seen) seenLeft.set(sku, (seenLeft.get(sku) ?? 0) + 1);
  const seenHere = new Set<number>();
  for (const i of here) {
    const n = seenLeft.get(units[i].sku) ?? 0;
    if (n > 0) {
      seenLeft.set(units[i].sku, n - 1);
      seenHere.add(i);
    }
  }

  if (want >= here.length) {
    const first = here.length ? here[0] : units.length;
    const last = here.length ? here[here.length - 1] : -1;
    // Las de después de la tarima van antes que las de antes, a igual distancia.
    const distance = (i: number) => (i > last ? (i - last) * 2 - 1 : (first - i) * 2);
    const others = units
      .map((_, i) => i)
      .filter((i) => units[i].fromPallet !== target)
      .sort((a, b) => distance(a) - distance(b));
    const extras: number[] = [];
    for (const i of others) {
      if (extras.length >= want - here.length) break;
      const n = seenLeft.get(units[i].sku) ?? 0;
      if (n > 0) {
        seenLeft.set(units[i].sku, n - 1);
        extras.push(i);
        reasons[i] = 'photo';
      }
    }
    for (const i of others) {
      if (extras.length >= want - here.length) break;
      if (extras.includes(i)) continue;
      extras.push(i);
      reasons[i] = 'next';
    }
    return { picked: [...here, ...extras], reasons };
  }

  // Sobran: primero las que la foto no vio, de la última cargada hacia atrás.
  const removable = [...here].reverse().sort((a, b) => {
    const sa = seenHere.has(a) ? 1 : 0;
    const sb = seenHere.has(b) ? 1 : 0;
    return sa - sb;
  });
  const off = new Set(removable.slice(0, here.length - want));
  off.forEach((i) => (reasons[i] = 'off'));
  return { picked: here.filter((i) => !off.has(i)), reasons };
}
