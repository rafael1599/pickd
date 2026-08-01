/**
 * The one place that decides what a large `locations.picking_order` means.
 *
 * The walking route tops out in the hundreds, so the numbers above this band
 * are not "very late in the walk" — they are a different statement: stock you
 * can reach, but should not be sent to while a normal shelf still has the SKU.
 * Buried pallets, palletized overflow.
 *
 * It lives in shared utils rather than inside the picking feature because two
 * features need the same answer: picking, to route around those shelves, and
 * warehouse-management, to show the operator that a location has been ranked
 * out of the way — a demotion nothing in the UI used to reveal.
 */

/** At or above this in `locations.picking_order` → a location of last resort. */
export const LAST_RESORT_PICKING_ORDER = 9000;

/**
 * Whether a raw `picking_order` marks a deliberately deprioritised location.
 *
 * Null is *not* last resort. Half the warehouse has no picking_order,
 * containers included, and reading "unranked" as "buried" would change where
 * nearly every pick is sourced from.
 */
export function isLastResortOrder(order: number | null | undefined): boolean {
  return typeof order === 'number' && order >= LAST_RESORT_PICKING_ORDER;
}
