// Choosing which shelf to send the picker to when a SKU sits in several.
//
// The choice used to be quantity and nothing else: whichever row held the most
// units won. That reads as sensible and is wrong often enough to be the single
// biggest source of manual corrections — a third of every replacement recorded
// in five months is a picker changing the location of a SKU they were happy
// with otherwise. The clearest case is a pallet whose location is literally
// named "42 BURIED": 39 units, so it beat a normal row holding 17, and the
// pickers re-routed it by hand four times in eight days.

/**
 * A location at or above this in `locations.picking_order` is stock you can
 * reach, but not stock you should be sent to while any normal shelf still has
 * the SKU — buried pallets, palletized overflow. Well clear of the real walking
 * order, which tops out in the hundreds.
 */
export const LAST_RESORT_PICKING_ORDER = 9000;

/** Picking order per location name, as `locations` records it. */
export type PickingOrderMap = ReadonlyMap<string, number | null>;

const norm = (s: string | null | undefined): string => (s || '').trim().toUpperCase();

/**
 * Whether this location is a last resort. An unranked location is *not* — half
 * the warehouse has no picking_order, containers included, and demoting all of
 * them would change where nearly every pick is sourced from. Only a location
 * someone deliberately ranked out of the way qualifies.
 */
export function isLastResort(
  location: string | null | undefined,
  order?: PickingOrderMap
): boolean {
  if (!order) return false;
  const value = order.get(norm(location));
  return typeof value === 'number' && value >= LAST_RESORT_PICKING_ORDER;
}

/** The subset of an inventory row this comparison needs. */
interface LocatedRow {
  location: string | null;
  quantity?: number | null;
}

/**
 * Orders candidate rows best-first: normal shelves before last-resort ones,
 * deepest stock first within each group.
 *
 * Two groups rather than one blended score, because the intent is a hard
 * precedence — a buried pallet is not "worth less", it is where you go once
 * nothing else has the bike. Without the map this is exactly the old
 * quantity sort, so every caller that has no locations loaded behaves as before.
 */
export function byPickPreference<T extends LocatedRow>(
  order?: PickingOrderMap
): (a: T, b: T) => number {
  return (a, b) => {
    const lastA = Number(isLastResort(a.location, order));
    const lastB = Number(isLastResort(b.location, order));
    if (lastA !== lastB) return lastA - lastB;
    return Number(b.quantity || 0) - Number(a.quantity || 0);
  };
}

/** Builds the lookup `byPickPreference` expects from raw `locations` rows. */
export function toPickingOrderMap(
  rows: { location: string | null; picking_order: number | null }[] | null | undefined
): PickingOrderMap {
  const map = new Map<string, number | null>();
  for (const row of rows ?? []) map.set(norm(row.location), row.picking_order);
  return map;
}
