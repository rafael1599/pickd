/**
 * Qué SKUs de una carga son bici, y cuáles de ellas de niño — la lectura del
 * catálogo que hace falta para repartir pallets.
 *
 * Vive aquí, y no junto a las reglas en `utils/bikeDetection.ts`, porque
 * consulta la base: las reglas son puras y un módulo de dominio las importa sin
 * arrastrar el cliente de Supabase (paso 0 de `docs/prds/ship-pallet-truth.md`).
 * Desde el paso 3 es la misma consulta que usan todas las pantallas
 * (`cartSkuMeta.service.ts`); replay de 855 órdenes, 0 diferencias.
 */
import { bikeSetsFrom, fetchCartSkuMeta } from './cartSkuMeta.service';

/**
 * Los dos conjuntos que el cálculo de pallets necesita, de una sola lectura:
 * las bicis y, dentro de ellas, las pequeñas. `smallBikes` es siempre un
 * subconjunto de `bikes` — una juvenil sigue siendo una bici para todo lo
 * demás (cartón de FedEx, etiqueta, unidad de talla); lo único que cambia es
 * que no pagina en pallets. Si la consulta falla, vacíos, como siempre.
 */
export async function resolveBikeSets(
  skus: string[]
): Promise<{ bikes: Set<string>; smallBikes: Set<string> }> {
  try {
    return bikeSetsFrom(await fetchCartSkuMeta(skus));
  } catch {
    return { bikes: new Set(), smallBikes: new Set() };
  }
}
