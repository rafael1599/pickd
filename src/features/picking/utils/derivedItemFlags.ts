/**
 * `sku_not_found` is derived by the database on every write of
 * picking_lists.items (migration 20260826180000: "no sku_metadata row has this
 * exact sku"), and re-derived on the open orders the moment a SKU enters the
 * catalog. The session's local cart only learns that from the row coming back
 * — a realtime UPDATE or the polling fallback — and this is the one place that
 * copies it over.
 *
 * Only that flag is merged. Everything else on a local item (picked, the split,
 * a quantity being edited) may be ahead of the row, and overwriting it with the
 * server's copy is the clobber the sync hook has always avoided. The flag is a
 * function of the SKU alone, so any server row with the same sku carries the
 * right value — split picks need no pairing by shelf.
 *
 * Returns null when nothing changed, so callers can skip the state write (in
 * picking mode a state write schedules an upload; a no-op one would only echo).
 */

export interface DerivedFlagItem {
  sku: string;
  sku_not_found?: boolean;
}

function isServerItem(value: unknown): value is DerivedFlagItem {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { sku?: unknown }).sku === 'string'
  );
}

export function mergeDerivedItemFlags<T extends DerivedFlagItem>(
  local: T[],
  serverItems: unknown
): T[] | null {
  if (!Array.isArray(serverItems) || local.length === 0) return null;
  const bySku = new Map<string, boolean>();
  for (const row of serverItems) {
    if (isServerItem(row) && !bySku.has(row.sku)) bySku.set(row.sku, !!row.sku_not_found);
  }
  if (bySku.size === 0) return null;

  let changed = false;
  const merged = local.map((item) => {
    const derived = bySku.get(item.sku);
    if (derived === undefined || !!item.sku_not_found === derived) return item;
    changed = true;
    return { ...item, sku_not_found: derived };
  });
  return changed ? merged : null;
}
