// Telling a combined order's read-only state apart from one list's own rows.
//
// A combined order is picked as one unit but stored as N rows. To make that
// workable, `usePickingSync.loadExternalList` unions every sibling's items into
// a single array for display — state that must never be written back, because
// each row is only meant to hold what it owns.

/** The only shape these guards need; keeps them usable from any write path. */
interface TaggedItem {
  source_list_id?: string;
}

/**
 * Whether `items` spans more than the list it is about to be saved to.
 *
 * The merge stamps every item with the row it came from, so an item whose
 * `source_list_id` is some other list is proof the array is the merged view.
 * That is a property of the data being written, which is what makes it
 * dependable: it holds no matter which save path is running or what it happens
 * to have in memory.
 */
export function holdsMergedGroupItems(items: TaggedItem[], listId: string | null): boolean {
  if (!listId) return false;
  return items.some((item) => !!item.source_list_id && item.source_list_id !== listId);
}

/**
 * Whether an order number is a combined display string ("880985 / 880977")
 * rather than a real one. Also the signal that the row itself is a
 * watchdog-combined list, whose contents can be ahead of the local snapshot.
 */
export function isCombinedOrderNumber(orderNum: string | null | undefined): boolean {
  return !!orderNum?.includes(' / ');
}

/**
 * Whether `items` must be left out of an update to `listId`.
 *
 * Two independent ways an array can fail to be this row's own contents, and
 * each catches what the other misses — which is why every write path asks this
 * one question instead of picking a side:
 *
 *   - It spans siblings. The array is the group's merged view. Writing it
 *     copies other rows' items into this one; because the merged view then
 *     unions them again, every bike shows twice and edits appear to do nothing
 *     because the stale copy keeps coming back (orders 880985 / 880977).
 *   - The order number is combined. The row is a watchdog-combined list, whose
 *     items the local cart can lag behind — realtime only syncs metadata — so
 *     writing the local snapshot deletes what the watchdog merged in. Order
 *     879460 lost 11 items this way on 2026-04-30.
 *
 * The second used to be the whole test. It is ambient state rather than
 * evidence, so any save path not holding the combined order number sailed past
 * it, which is how the merged array reached the database in the first place.
 */
export function isUnsafeToWriteItems(
  items: TaggedItem[],
  listId: string | null,
  orderNum: string | null | undefined
): boolean {
  return holdsMergedGroupItems(items, listId) || isCombinedOrderNumber(orderNum);
}
