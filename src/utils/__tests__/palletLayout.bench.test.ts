/**
 * El banco de las tarimas medidas con cinta: el alto que da el motor contra el
 * que tecleó el piso, tarima por tarima.
 *
 * Hasta el 3 oct 2026 esta cifra vivía sólo en un mensaje de commit (19
 * tarimas, 3,0" de error medio con el ladeo de 7°). El fixture es la carga de
 * cada tarima medida en `shipments.pallet_dims`, repartida con el mismo
 * camino que Ship (orden de recogida + `planPallets` con lo que dijo el piso)
 * el día que se generó, y las medidas de cada caja tal como estaban en el
 * catálogo. Sólo SKUs y medidas: ningún texto leído de una foto. Para
 * regenerarlo hace falta prod; el test no.
 *
 * Mide `layoutPallet` como lo mide Ship (`estimateLayout`: una tarima de
 * niño, todas de niño). **Dos errores van mezclados**: qué bicis le tocan a
 * cada tarima (lo reparte el motor y el piso a veces arma otra cosa —
 * idea-245—) y cómo se apilan. Por eso se separan las tarimas cuya carga es un
 * hecho (`loadKnown`: armada a mano, o un envío de una sola tarima): sólo ahí
 * el error es del armado. Al 3 oct 2026 son 4 de 27; los frentes confirmados
 * de idea-245 son los que van a llenar ese grupo.
 *
 * Quitar el ladeo (1 oct 2026) no movió ninguna de las 27: con y sin él dan lo
 * mismo, 8,00" de error medio.
 */
import { describe, expect, it } from 'vitest';
import { layoutPallet } from '../palletLayout';
import type { PalletBoxMeta, PalletLine } from '../palletDims';
import pallets from './fixtures/measuredPallets.json';

interface MeasuredPallet {
  shipment: string;
  orders: string[];
  pallet: number;
  loadKnown: boolean;
  isKids: boolean;
  tape: { height_in: number };
  lines: PalletLine[];
  kids: string[];
  meta: Record<string, PalletBoxMeta | null>;
}

const bench = (pallets as unknown as MeasuredPallet[]).map((p) => {
  const layout = layoutPallet(
    p.lines,
    (sku) => p.meta[sku] ?? undefined,
    p.isKids ? () => true : (sku) => p.kids.includes(sku)
  );
  return { ...p, engine: layout?.height ?? null };
});
const scored = bench.filter((p) => p.engine != null);
const errors = scored.map((p) => p.engine! - p.tape.height_in);
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const known = scored.flatMap((p, i) => (p.loadKnown ? [errors[i]] : []));

describe('banco: alto del motor contra la cinta', () => {
  it('imprime el error tarima por tarima', () => {
    const rows = scored.map(
      (p, i) =>
        `${p.loadKnown ? '●' : ' '} ${p.orders.join('+').padEnd(20)} #${p.pallet}  cinta ${String(p.tape.height_in).padStart(5)}"  motor ${p.engine!.toFixed(1).padStart(5)}"  ${errors[i] >= 0 ? '+' : ''}${errors[i].toFixed(1)}`
    );
    console.log(
      [
        ...rows,
        `tarimas ${scored.length} de ${bench.length}`,
        `error medio |motor − cinta| ${mean(errors.map(Math.abs)).toFixed(2)}"`,
        `sesgo medio (motor − cinta) ${mean(errors).toFixed(2)}"`,
        `● carga conocida: ${known.length} tarimas, error medio ${known.length ? mean(known.map(Math.abs)).toFixed(2) : '—'}"`,
      ].join('\n')
    );
    expect(scored.length).toBeGreaterThan(20);
  });

  // Un tope, no una meta: que una regla nueva no empeore en silencio lo que
  // el piso ya midió. La meta de F2 (idea-245) es ≤ 2,0".
  it('el error medio no pasa de su tope', () => {
    expect(mean(errors.map(Math.abs))).toBeLessThanOrEqual(BENCH_MAX_MEAN_ERROR_IN);
  });
});

/** El error medio del 3 oct 2026 (8,00") y un cuarto de pulgada de holgura. */
const BENCH_MAX_MEAN_ERROR_IN = 8.25;
