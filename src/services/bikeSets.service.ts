/**
 * Qué SKUs de una carga son bici, y cuáles de ellas de niño — la lectura del
 * catálogo que hace falta para repartir pallets.
 *
 * Vive aquí, y no junto a las reglas en `utils/bikeDetection.ts`, porque
 * consulta la base: las reglas son puras y un módulo de dominio las importa sin
 * arrastrar el cliente de Supabase (paso 0 de `docs/prds/ship-pallet-truth.md`).
 */
import { supabase } from '../lib/supabase';
import { isBikeSku, isSmallBikeSku } from '../utils/bikeDetection';

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

  type Row = {
    sku: string;
    is_bike: boolean | null;
    weight_lbs: number | null;
    model: string | null;
    as400_description: string | null;
  };
  const bySku = new Map((data as Row[]).map((row) => [row.sku, row]));
  // Every SKU asked about, not every row answered: an unregistered bike has no
  // row and is still a bike by its prefix (isBikeSku).
  unique.forEach((sku) => {
    const row = bySku.get(sku);
    if (!isBikeSku(sku, row ?? null)) return;
    bikes.add(sku);
    if (isSmallBikeSku(row ?? sku)) smallBikes.add(sku);
  });

  return { bikes, smallBikes };
}
