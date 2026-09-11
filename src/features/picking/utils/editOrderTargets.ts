/**
 * Which order of a combined group each line of Edit Order belongs to, and the
 * tabs that let the operator work one order at a time.
 *
 * A combined order is N rows edited on one screen. Every correction has to be
 * written to the row that owns the line, and that used to be found by SKU —
 * the first line with that SKU won. Two orders of one group sharing a SKU is
 * not rare (25 groups in the six months to Sep 2026), and there a Replace or a
 * Remove landed on whichever order came first. The line knows its own row:
 * `loadExternalList` tags every line with `source_list_id`.
 */

export interface OrderTaggedLine {
  source_list_id?: string;
  source_order?: string;
}

/**
 * The row a line belongs to: its own tag, else its order number looked up in
 * the group, else the list being edited (a single order's lines carry no tag).
 */
export function rowOfLine(
  line: OrderTaggedLine,
  orders: ReadonlyMap<string, string>,
  fallbackListId: string | null | undefined
): string | undefined {
  return (
    line.source_list_id ||
    (line.source_order ? orders.get(line.source_order) : undefined) ||
    fallbackListId ||
    undefined
  );
}

export interface OrderTab {
  rowId: string;
  orderNumber: string;
  /** Lines of this order on screen. */
  lines: number;
  /** Of those, the ones still flagged as a problem. */
  issues: number;
}

/**
 * One tab per order of the group, newest number first — the way Double Check
 * writes the combined number ("881514 / 881513"). An order with no lines keeps
 * its tab: it is still somewhere a line can be added.
 */
export function buildOrderTabs<T extends OrderTaggedLine>(
  lines: readonly T[],
  problems: ReadonlySet<T>,
  orders: ReadonlyMap<string, string>,
  fallbackListId: string | null | undefined
): OrderTab[] {
  const tabs = [...orders.entries()].map(([orderNumber, rowId]) => ({
    rowId,
    orderNumber,
    lines: 0,
    issues: 0,
  }));
  const byRow = new Map(tabs.map((tab) => [tab.rowId, tab]));
  for (const line of lines) {
    const tab = byRow.get(rowOfLine(line, orders, fallbackListId) ?? '');
    if (!tab) continue;
    tab.lines += 1;
    if (problems.has(line)) tab.issues += 1;
  }
  return tabs.sort((a, b) =>
    b.orderNumber.localeCompare(a.orderNumber, undefined, { numeric: true })
  );
}

/**
 * Where a new line goes before the operator says otherwise: the order they are
 * looking at, or the only order there is. Looking at all of them is not an
 * answer — that is when they are asked.
 */
export function defaultAddTarget(
  filterRowId: string | null,
  tabs: readonly OrderTab[]
): string | null {
  if (filterRowId) return filterRowId;
  return tabs.length === 1 ? tabs[0].rowId : null;
}
