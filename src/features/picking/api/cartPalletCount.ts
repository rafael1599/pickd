/**
 * Cuántos pallets físicos lleva una carga, como lo guarda el carrito al
 * completar: la ruta de recogida, qué SKUs son bici (consulta el catálogo) y el
 * reparto de `pallets/planPallets.ts`. Estaba copiado en tres sitios de
 * `PickingCartDrawer` (la orden, cada hermana, el Add-On).
 */
import type { Location } from '../../../schemas/location.schema';
import { getOptimizedPickingPath, type PickingItem } from '../../../utils/pickingLogic';
import { resolvePalletInputs } from '../../../services/bikeSets.service';
import type { PalletDimsEntry } from '../../../utils/palletDims';
import { countPhysicalPallets, planPallets } from '../pallets/planPallets';

export async function countCartPallets(
  items: PickingItem[],
  locations: Location[],
  /** Lo que el piso dijo de cada tarima (`pallet_dims`), si hay. */
  floor?: readonly PalletDimsEntry[] | null
): Promise<number> {
  const path = getOptimizedPickingPath(items, locations);
  const { sets, metaFor } = await resolvePalletInputs(path.map((i) => i.sku));
  return countPhysicalPallets(planPallets(path, sets, { floor, metaFor }));
}
