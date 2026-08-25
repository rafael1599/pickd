/**
 * Which inventory rows to show for one SKU, and in what order — the data
 * behind the "where is it" sheet a picker opens by long-pressing an item.
 *
 * The order's own address goes first and is kept even when empty, so a stale
 * pick location reads as "0 here" instead of quietly vanishing from the list.
 * Every other row has to hold stock to earn a line: a SKU that once lived in
 * ROW 8 and left is history, not a place to walk to.
 */

const norm = (s: string | null | undefined): string => (s ?? '').trim().toUpperCase();

/** The subset of an inventory row this arrangement reads. */
export interface LocatedStockRow {
  location: string | null;
  warehouse?: string | null;
  quantity?: number | null;
  is_active?: boolean | null;
}

/** The address an order sends the picker to. */
export interface PickAddress {
  location: string | null | undefined;
  /** Optional — an order written before warehouses were stamped has none. */
  warehouse?: string | null;
}

export interface ArrangedSkuLocation<T extends LocatedStockRow> {
  row: T;
  /** This row is the order's own address. */
  isPick: boolean;
}

export interface ArrangedSkuLocations<T extends LocatedStockRow> {
  rows: ArrangedSkuLocation<T>[];
  /** The order names an address that has no inventory row at all. */
  pickRowMissing: boolean;
}

export function isPickRow(row: LocatedStockRow, pick: PickAddress | null | undefined): boolean {
  if (!pick?.location) return false;
  if (norm(row.location) !== norm(pick.location)) return false;
  return !pick.warehouse || norm(row.warehouse) === norm(pick.warehouse);
}

export function arrangeSkuLocations<T extends LocatedStockRow>(
  rows: T[],
  pick: PickAddress | null | undefined
): ArrangedSkuLocations<T> {
  const arranged = rows
    .map((row) => ({ row, isPick: isPickRow(row, pick) }))
    .filter(({ row, isPick }) => isPick || (row.is_active !== false && (row.quantity ?? 0) > 0))
    .sort(
      (a, b) =>
        Number(b.isPick) - Number(a.isPick) ||
        (b.row.quantity ?? 0) - (a.row.quantity ?? 0) ||
        norm(a.row.location).localeCompare(norm(b.row.location), undefined, { numeric: true })
    );
  const pickRowMissing = !!pick?.location && !arranged.some((r) => r.isPick);
  return { rows: arranged, pickRowMissing };
}
