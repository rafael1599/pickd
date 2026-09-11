/**
 * What Double Check learns from the live stock about a line, and which row it
 * gets written to.
 *
 * Double Check reads the SKU's inventory while the order is on screen and can
 * settle three things the stored line still has wrong: a line with no address
 * gets the preferred shelf, a LOW STOCK flag the stock now covers is cleared,
 * and a SKU registered mid-session stops reading UNREG. Those have to reach the
 * row, or the screen and the deduction disagree: `process_picking_list` skips
 * every line still flagged `insufficient_stock`, and a line with no address has
 * no shelf to come off.
 *
 * The row is the hard part. A combined cart is N rows' lines side by side,
 * each tagged with the row it came from (`usePickingSync.loadExternalList`).
 * Writing the cart into the row that happens to anchor it copies the siblings'
 * lines in, and that row then completes with lines that are not its own:
 *
 *   - 9 sep 2026, #881393 took the lines of #881392, #881395 and #881397 and
 *     deducted them; #881395 and #881397 then deducted their own, and two bikes
 *     came off ROW 10 twice.
 *   - 11 sep 2026, #881513 took the part of #881514, and #881514 — which kept
 *     its own line with no address — completed three times deducting nothing.
 *
 * Both started the same way: stock added, from inside the combined view, for a
 * part that had none.
 */

export interface LiveResolvable {
  sku: string;
  location?: string | null;
  warehouse?: string | null;
  sublocation?: string[] | null;
  pickingQty?: number;
  sku_not_found?: boolean;
  insufficient_stock?: boolean;
  /** Set by the combined-cart merge; absent on a row's own stored lines. */
  source_list_id?: string;
}

/** What the view knows about the stock right now. */
export interface LiveStock {
  /** Where to pick a line that has no address: sku → preferred location. */
  preferredLocation: Readonly<Record<string, string>>;
  /** `${sku}-${LOCATION}` → the letters of the squares it sits in. */
  sublocations: Readonly<Record<string, string[]>>;
  /** Units the SKU holds across the warehouse, or undefined when unknown. */
  totalStock: (sku: string, skuNotFound: boolean) => number | undefined;
  /** Units other open orders already hold for the SKU in that warehouse. */
  reservedElsewhere: (sku: string, warehouse: string) => number;
  /** Whether the SKU has an inventory row now, whatever its quantity. */
  isRegistered: (sku: string) => boolean;
}

/**
 * The line as the live stock settles it, or null when nothing changes.
 *
 * A line that already has an address keeps it — moving a pick that has one is
 * the planner's decision (`planPickForList`), not this one's.
 */
export function resolveLiveItem<T extends LiveResolvable>(item: T, stock: LiveStock): T | null {
  const next: T = { ...item };
  let changed = false;

  // Registered since intake. The DB derives this on every write of items, but
  // the local copy only learns it from the round-trip.
  if (next.sku_not_found && stock.isRegistered(next.sku)) {
    next.sku_not_found = false;
    changed = true;
  }

  const preferred = stock.preferredLocation[next.sku];
  if (!next.location && preferred) {
    next.location = preferred;
    const squares = stock.sublocations[`${next.sku}-${preferred.toUpperCase()}`];
    if (squares && squares.length > 0) next.sublocation = squares;
    changed = true;
  }

  if (next.insufficient_stock) {
    const total = stock.totalStock(next.sku, !!item.sku_not_found) ?? 0;
    const reserved = stock.reservedElsewhere(next.sku, next.warehouse || 'LUDLOW');
    if (total - reserved >= (next.pickingQty || 0)) {
      next.insufficient_stock = false;
      changed = true;
    }
  }

  return changed ? next : null;
}

/** Alphanumeric by location, then by first square — the order the row is kept in. */
export function sortByLocation<T extends LiveResolvable>(items: readonly T[]): T[] {
  return [...items].sort((a, b) => {
    const locA = a.location || '';
    const locB = b.location || '';
    if (locA !== locB) {
      return locA.localeCompare(locB, undefined, { numeric: true, sensitivity: 'base' });
    }
    const subA = Array.isArray(a.sublocation) && a.sublocation.length > 0 ? a.sublocation[0] : '';
    const subB = Array.isArray(b.sublocation) && b.sublocation.length > 0 ? b.sublocation[0] : '';
    return subA.localeCompare(subB);
  });
}

/**
 * Resolve one row's OWN stored lines. `changed` false means the row already
 * says what the stock says, and writing it would only echo through realtime.
 */
export function resolveRowItems<T extends LiveResolvable>(
  items: readonly T[],
  stock: LiveStock
): { items: T[]; changed: boolean } {
  let changed = false;
  const resolved = items.map((item) => {
    const next = resolveLiveItem(item, stock);
    if (!next) return item;
    changed = true;
    return next;
  });
  return { items: changed ? sortByLocation(resolved) : [...items], changed };
}

/**
 * Which rows of the cart have a line the stock now settles, keyed by row, each
 * with the keys that identify what was settled.
 *
 * The row is the line's `source_list_id`, falling back to the list on screen
 * for a single order (whose lines carry no tag). The keys include the answer,
 * so a line already persisted is skipped until the stock says something new
 * about it — the cart on screen keeps its unresolved copy, and without the key
 * every realtime echo would ask the same question again.
 */
export function pendingResolutions(
  cartItems: readonly LiveResolvable[],
  fallbackListId: string,
  stock: LiveStock,
  settled: ReadonlySet<string>
): Map<string, string[]> {
  const byRow = new Map<string, string[]>();
  for (const item of cartItems) {
    const next = resolveLiveItem(item, stock);
    if (!next) continue;
    const rowId = item.source_list_id || fallbackListId;
    const key = [
      rowId,
      item.sku,
      (item.location || '').toUpperCase(),
      (next.location || '').toUpperCase(),
      next.insufficient_stock ? 'short' : 'covered',
      next.sku_not_found ? 'unreg' : 'reg',
    ].join('|');
    if (settled.has(key)) continue;
    byRow.set(rowId, [...(byRow.get(rowId) ?? []), key]);
  }
  return byRow;
}
