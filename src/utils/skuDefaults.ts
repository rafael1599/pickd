/**
 * What an unmeasured SKU weighs and measures, by type.
 *
 * ⚠️ Mirror of the `set_is_bike_on_insert` trigger on `sku_metadata` — the
 * database is the authority, this exists so a form can pre-fill without a
 * round-trip. Change one and change the other, same as the FedEx
 * classification rule.
 *
 * The numbers used to disagree in three places at once: 0 lbs in
 * ItemDetailView, 0.1 in ShipScreen, 45 in inventory.service and the column
 * default. 45 is a boxed bicycle, so every pedal added a bike to the shipment
 * weight — 1,376 of 1,387 parts were sitting at exactly that.
 */

/** A boxed bicycle. */
export const BIKE_SKU_DEFAULTS = {
  length_in: 55,
  width_in: 8.5,
  height_in: 30.5,
  weight_lbs: 45,
} as const;

/**
 * A part. 1 lb rather than 0 so a missing weight never reads as weightless in
 * a shipment total, and rather than 0.1 so the number stays legible to whoever
 * has to sanity-check it on the floor.
 */
export const PART_SKU_DEFAULTS = {
  length_in: 0,
  width_in: 0,
  height_in: 0,
  weight_lbs: 1,
} as const;

/**
 * Defaults for a SKU whose type is known. An unknown type (`null`/`undefined`)
 * falls to the bike side, matching the trigger's prefix guess — most
 * unclassified SKUs that reach these paths are bikes, and under-weighting a
 * bike is the more expensive mistake of the two.
 */
export function skuDefaultsFor(
  isBike: boolean | null | undefined
): typeof BIKE_SKU_DEFAULTS | typeof PART_SKU_DEFAULTS {
  return isBike === false ? PART_SKU_DEFAULTS : BIKE_SKU_DEFAULTS;
}
