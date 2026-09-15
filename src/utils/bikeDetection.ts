import { supabase } from '../lib/supabase';

/**
 * Canonical bike detection helper.
 * `sku_metadata.is_bike` in the database is the SOLE source of truth.
 *
 * Fallback: If `is_bike` is null/uncataloged in DB, uses weight heuristic
 * (`weight_lbs >= 15` lbs, since boxed bicycles weigh 25–50+ lbs).
 */
export function isBikeSku(
  skuOrObj?:
    | string
    | {
        sku?: string;
        is_bike?: boolean | null;
        weight_lbs?: number | null;
        sku_metadata?: { is_bike?: boolean | null; weight_lbs?: number | null } | null;
      }
    | null,
  skuMetadata?: { is_bike?: boolean | null; weight_lbs?: number | null } | null
): boolean {
  if (!skuOrObj) return false;

  let isBikeFlag: boolean | null | undefined;
  let weightLbs: number | null | undefined;

  if (typeof skuOrObj === 'string') {
    isBikeFlag = skuMetadata?.is_bike;
    weightLbs = skuMetadata?.weight_lbs;
  } else if (typeof skuOrObj === 'object') {
    if ('sku_metadata' in skuOrObj && skuOrObj.sku_metadata) {
      isBikeFlag = skuOrObj.sku_metadata.is_bike;
      weightLbs = skuOrObj.sku_metadata.weight_lbs;
    } else {
      isBikeFlag = skuOrObj.is_bike;
      weightLbs = skuOrObj.weight_lbs;
    }
    if (isBikeFlag === undefined && skuMetadata?.is_bike !== undefined) {
      isBikeFlag = skuMetadata.is_bike;
    }
    if (weightLbs === undefined && skuMetadata?.weight_lbs !== undefined) {
      weightLbs = skuMetadata.weight_lbs;
    }
  }

  // 1. Explicit DB flag in sku_metadata is the SOLE canonical source of truth
  if (isBikeFlag === true) return true;
  if (isBikeFlag === false) return false;

  // 2. Emergency fallback ONLY for uncataloged items in DB (when is_bike is null/undefined):
  // Boxed bicycles weigh >= 15 lbs.
  if (typeof weightLbs === 'number' && weightLbs >= 15) return true;

  return false;
}

/**
 * Una bici de línea juvenil o de rueda chica.
 *
 * No es un juicio sobre el peso ni sobre la talla del cuadro: es la línea de
 * producto. El cartón lo confirma — con dimensiones verificadas, las 14 bicis
 * con caja de 26" de alto o menos son exactamente éstas, y ninguna adulta baja
 * de 27" — pero el peso no sirve de criterio y por eso no se usa: la Ventura
 * A1 y la Renegade C1 pesan 31–33 lb, menos que una CAPRI 2.4, y son bicis de
 * carretera de caja entera.
 *
 * Las señales, en orden de cobertura real (15 sep 2026, 39 SKUs / 1.202 u):
 *   - **Prefijo `07-`**: el código de línea juvenil de Jamis. 27 SKUs, 1.001
 *     unidades — la señal que de verdad pesa, y la única que llega gratis con
 *     cada SKU nuevo que cree el registrador o el escáner del AS400.
 *   - **`JUV` al principio** de la descripción del AS400 o del modelo: recoge
 *     la juvenil que quedó fuera del prefijo (`02-3683GN`).
 *   - **Taxi de rueda 16/20/24**: la Taxi 26" es adulta (caja de 28–30"), la
 *     de 24" no (25–25.5"). 5 SKUs, 198 unidades.
 *   - **Nombre de modelo juvenil** para las filas viejas escaneadas sin número
 *     de Jamis: `Starlite`, `XR.20`, `XR.24`.
 *
 * **Sólo tiene sentido preguntárselo a una bici.** El catálogo de partes está
 * lleno de `JRP GRIP LASER 2.0`, `JRP PEDAL CAPRI 2.4` y `JRP GRIP STARLITE`:
 * 30 partes contestarían que sí. Quien llame a esto cruza el resultado con el
 * conjunto de bicis — {@link resolveBikeSets} lo hace por dentro.
 */
export function isSmallBikeSku(
  skuOrRow?:
    | string
    | { sku?: string; model?: string | null; as400_description?: string | null }
    | null,
  meta?: { model?: string | null; as400_description?: string | null } | null
): boolean {
  if (!skuOrRow) return false;

  const sku = (typeof skuOrRow === 'string' ? skuOrRow : (skuOrRow.sku ?? '')).trim().toUpperCase();
  const row = typeof skuOrRow === 'string' ? meta : skuOrRow;
  const model = (row?.model ?? meta?.model ?? '').trim();
  const desc = (row?.as400_description ?? meta?.as400_description ?? '').trim();

  // El código de línea de Jamis. Vale por sí solo y sin ficha: un `07-` recién
  // creado ya se sabe juvenil antes de que el escáner lo lea.
  if (sku.startsWith('07-')) return true;

  const text = `${model} ${desc}`;
  if (/^\s*JUV\b/i.test(model) || /^\s*JUV\b/i.test(desc)) return true;

  // La rueda tiene que ir pegada a TAXI: `TAXI 26" S/O 18` no es chica.
  if (/\bTAXI\s*(?:10X)?(?:16|20|24)\b/i.test(text)) return true;

  // Modelos juveniles escritos sin el `JUV` delante (filas escaneadas viejas).
  // `XR.20` lleva punto a propósito: `TRAIL XR S/O 20` es una bici adulta.
  if (/\b(?:STARLITE|MISS\s*DAISY|CRITTER|HOT\s*ROD|CAPRI|LASER)\b/i.test(text)) return true;
  if (/\bXR?\.\d{2}\b/i.test(text)) return true;

  return false;
}

/**
 * Los dos conjuntos que el cálculo de pallets necesita, de una sola lectura:
 * las bicis y, dentro de ellas, las pequeñas. `smallBikes` es siempre un
 * subconjunto de `bikes` — una juvenil sigue siendo una bici para todo lo
 * demás (cartón de FedEx, etiqueta, unidad de talla); lo único que cambia es
 * que no pagina en pallets.
 */
export async function resolveBikeSets(
  skus: string[]
): Promise<{ bikes: Set<string>; smallBikes: Set<string> }> {
  const unique = Array.from(new Set(skus.filter(Boolean)));
  const bikes = new Set<string>();
  const smallBikes = new Set<string>();
  if (unique.length === 0) return { bikes, smallBikes };

  const { data, error } = await supabase
    .from('sku_metadata')
    .select('sku, is_bike, weight_lbs, model, as400_description')
    .in('sku', unique);

  if (error || !data) return { bikes, smallBikes };

  (
    data as {
      sku: string;
      is_bike: boolean | null;
      weight_lbs: number | null;
      model: string | null;
      as400_description: string | null;
    }[]
  ).forEach((row) => {
    if (!isBikeSku(row.sku, row)) return;
    bikes.add(row.sku);
    if (isSmallBikeSku(row)) smallBikes.add(row.sku);
  });

  return { bikes, smallBikes };
}
