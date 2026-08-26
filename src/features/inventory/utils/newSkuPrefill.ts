/**
 * Everything the add form can know about a SKU before the operator touches
 * it, built from what an order already carries (SKU, AS400 description) and
 * the type they just chose. What is left for them is what only the floor
 * knows: where it is and how many.
 *
 * Without this, registering a SKU the watchdog could not match meant walking
 * a type gate, then typing the name again and the model, size and colour by
 * hand — for someone who wants to register the thing and get back to picking.
 */
import type { RegisterType } from '../../../components/ui/RegisterTypeSelector';
import { normalizeSkuOnRegister } from '../../../utils/skuNormalize';
import type { InventoryItemWithMetadata } from '../../../schemas/inventory.schema';
import { skuDefaultsFor } from '../../../utils/skuDefaults';
import { parseBikeName } from './parseBikeName';

export interface NewSkuSource {
  sku: string;
  /** What the order calls it — the AS400 description for a watchdog import. */
  itemName?: string | null;
  warehouse?: string | null;
}

export function buildNewSkuPrefill(
  source: NewSkuSource,
  kind: RegisterType
): InventoryItemWithMetadata {
  const isBike = kind === 'bike';
  const name = (source.itemName ?? '').trim();
  const defaults = skuDefaultsFor(isBike);

  // Bikes: "EXPLORER A2 15 2026 GLOSS BLACK" splits into model / size / colour,
  // and the catalogue names a bike "Model Size Colour" (register_new_sku,
  // 20260717200000), so the year is dropped on purpose. A name that does not
  // split stays a name only: a whole name stuffed into `model` is the legacy
  // shape the catalogue is still being cleaned of, and it is the FedEx
  // export's grouping key. Parts carry the description as their model, the
  // same way the structured register files them.
  let model: string | null = null;
  let size: string | null = null;
  let color: string | null = null;
  if (isBike) {
    const parsed = parseBikeName(name);
    if (parsed.size) {
      model = parsed.model;
      size = parsed.size;
      color = parsed.color || null;
    }
  } else if (name) {
    model = name;
  }

  // The order line may still carry the watcher's spelling of a SKU nobody
  // registered ('010530'); the row is registered under the canonical one.
  const sku = normalizeSkuOnRegister(source.sku);

  return {
    sku: sku,
    item_name: name || null,
    warehouse: source.warehouse === 'ATS' ? 'ATS' : 'LUDLOW',
    location: null,
    quantity: 0,
    is_active: true,
    distribution: [],
    sku_metadata: {
      sku: sku,
      is_bike: isBike,
      length_in: defaults.length_in,
      width_in: defaults.width_in,
      height_in: defaults.height_in,
      weight_lbs: defaults.weight_lbs,
      model,
      size,
      color,
    },
  } as unknown as InventoryItemWithMetadata;
}
