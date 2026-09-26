/**
 * Lo que el catálogo dice de cada línea de una carga — la única consulta.
 *
 * Paso 3 de `docs/prds/ship-pallet-truth.md` (R6/D6): Ship, Double Check y el
 * carrito consultaban `sku_metadata` cada uno a su manera — columnas distintas,
 * con y sin `inventorySkuCandidates`, con y sin la regla de prefijo para un SKU
 * sin ficha. Ésta es la de Ship, que era la completa: busca cada SKU por sus
 * candidatos (`034664BR` encuentra `03-4664BR`) y decide bici con `isBikeSku`,
 * que mira el catálogo y, si no hay ficha, el prefijo.
 *
 * Vive en `services/` porque consulta la base; las reglas siguen puras en
 * `utils/bikeDetection.ts`.
 */
import { supabase } from '../lib/supabase';
import { isBikeSku, isSmallBikeSku } from '../utils/bikeDetection';
import { inventorySkuCandidates } from '../utils/skuNormalize';

/** El catálogo de una línea, bajo el SKU tal como lo escribe la orden. */
export interface CartSkuMeta {
  /** La fila que se encontró (puede ser otra grafía); null si no hay ficha. */
  catalog_sku: string | null;
  is_bike: boolean;
  /** De niño o de rueda chica: una bici que no pagina en pallets grandes. */
  is_small_bike: boolean;
  weight_lbs: number | null;
  length_in: number | null;
  width_in: number | null;
  height_in: number | null;
  dimensions_verified: boolean;
  dimensions_measured_at: string | null;
  model: string | null;
  size: string | null;
  category: string | null;
  as400_description: string | null;
  is_scratch_dent: boolean;
  serial_number: string | null;
}

const COLUMNS =
  'sku, weight_lbs, is_bike, length_in, width_in, height_in, dimensions_verified, dimensions_measured_at, model, size, category, as400_description, is_scratch_dent, serial_number';

/** Una fila de `sku_metadata` con las columnas que se leen. */
export interface CatalogRow {
  sku: string;
  weight_lbs: number | null;
  is_bike: boolean | null;
  length_in: number | null;
  width_in: number | null;
  height_in: number | null;
  dimensions_verified: boolean | null;
  dimensions_measured_at: string | null;
  model: string | null;
  size: string | null;
  category: string | null;
  as400_description: string | null;
  is_scratch_dent: boolean | null;
  serial_number: string | null;
}

/** La clave estable de un conjunto de SKUs: sin repetidos, ordenada. */
export function cartSkusKey(skus: ReadonlyArray<string | null | undefined>): string {
  return Array.from(new Set(skus.filter((s): s is string => !!s)))
    .sort()
    .join(',');
}

/**
 * El catálogo de cada SKU pedido. **Lanza** si la consulta falla: quien llama
 * decide qué hacer (el hook lo deja en error; `resolveBikeSets` cae a vacío).
 */
export async function fetchCartSkuMeta(
  skus: ReadonlyArray<string>
): Promise<Record<string, CartSkuMeta>> {
  const unique = Array.from(new Set(skus.filter(Boolean)));
  if (unique.length === 0) return {};
  const candidates = [...new Set(unique.flatMap((s) => inventorySkuCandidates(s)))];
  const { data, error } = await supabase.from('sku_metadata').select(COLUMNS).in('sku', candidates);
  if (error) throw new Error(error.message);
  return buildCartSkuMeta(unique, (data ?? []) as unknown as CatalogRow[]);
}

/**
 * La parte pura: con las filas del catálogo ya leídas, lo que cada SKU es. La
 * primera fila que encuentran sus candidatos manda; sin fila, el prefijo.
 */
export function buildCartSkuMeta(
  skus: ReadonlyArray<string>,
  rows: ReadonlyArray<CatalogRow>
): Record<string, CartSkuMeta> {
  const bySku = new Map(rows.map((row) => [row.sku, row]));
  const out: Record<string, CartSkuMeta> = {};
  for (const sku of new Set(skus.filter(Boolean))) {
    const row = inventorySkuCandidates(sku)
      .map((c) => bySku.get(c))
      .find((r): r is CatalogRow => !!r);
    const isBike = isBikeSku(sku, row ?? null);
    out[sku] = {
      catalog_sku: row?.sku ?? null,
      is_bike: isBike,
      is_small_bike: isBike && isSmallBikeSku(row ?? sku),
      weight_lbs: row?.weight_lbs ?? null,
      length_in: row?.length_in ?? null,
      width_in: row?.width_in ?? null,
      height_in: row?.height_in ?? null,
      dimensions_verified: row?.dimensions_verified ?? false,
      dimensions_measured_at: row?.dimensions_measured_at ?? null,
      model: row?.model ?? null,
      size: row?.size ?? null,
      category: row?.category ?? null,
      as400_description: row?.as400_description ?? null,
      is_scratch_dent: row?.is_scratch_dent ?? false,
      serial_number: row?.serial_number ?? null,
    };
  }
  return out;
}

/** Los dos conjuntos que pide el reparto de pallets. */
export function bikeSetsFrom(meta: Readonly<Record<string, CartSkuMeta>>): {
  bikes: Set<string>;
  smallBikes: Set<string>;
} {
  const bikes = new Set<string>();
  const smallBikes = new Set<string>();
  for (const [sku, m] of Object.entries(meta)) {
    if (!m.is_bike) continue;
    bikes.add(sku);
    if (m.is_small_bike) smallBikes.add(sku);
  }
  return { bikes, smallBikes };
}
