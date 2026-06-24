/**
 * Stock-aware substitution helpers for Edit Order.
 *
 * When an ordered SKU runs out of stock, PickD can resolve it to an equivalent
 * SKU that DOES have stock — either a hardcoded substitute (see SKU_SUBSTITUTES
 * in utils/skuNormalize) auto-applied on open, or a same-model sibling surfaced
 * as a one-tap suggestion (see findSimilarSkus). This module holds the pure,
 * testable piece: choosing the best in-stock row for a target SKU.
 */

/** Minimal shape needed to rank a candidate inventory row. */
export interface StockRow {
  sku: string;
  location: string | null;
  warehouse: string;
  item_name?: string | null;
  quantity: number;
}

/**
 * From a set of inventory rows, pick the best in-stock row for `sku` in
 * `warehouse` — the active row holding the most units. Returns null when no row
 * for that SKU/warehouse carries stock.
 *
 * Quantity is the tiebreaker so an auto-swap always lands on the location most
 * likely to cover the order in a single pick.
 */
export function pickBestStockRow<T extends StockRow>(
  rows: T[],
  sku: string,
  warehouse: string
): T | null {
  const inStock = rows.filter(
    (r) => r.sku === sku && r.warehouse === warehouse && (r.quantity ?? 0) > 0
  );
  if (inStock.length === 0) return null;
  return [...inStock].sort((a, b) => (b.quantity ?? 0) - (a.quantity ?? 0))[0];
}
