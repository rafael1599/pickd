/**
 * Stock-aware substitution helpers for Edit Order.
 *
 * When an ordered SKU runs out of stock, PickD can resolve it to an equivalent
 * SKU that DOES have stock — either a hardcoded substitute (see SKU_SUBSTITUTES
 * in utils/skuNormalize) auto-applied on open, or a same-model sibling surfaced
 * as a one-tap suggestion (see findSimilarSkus). This module holds the pure,
 * testable piece: choosing the best in-stock row for a target SKU.
 */

import { byPickPreference, type PickingOrderMap } from './pickLocation';

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
 * `warehouse`. Returns null when no row for that SKU/warehouse carries stock.
 *
 * Quantity decides, so an auto-swap lands on the location most likely to cover
 * the order in a single pick — but only among shelves worth walking to. Pass
 * `pickingOrder` to keep a deliberately deprioritised location (a buried
 * pallet) out of the running while a normal row still has the bike; without it
 * this is the plain quantity sort it has always been.
 */
export function pickBestStockRow<T extends StockRow>(
  rows: T[],
  sku: string,
  warehouse: string,
  pickingOrder?: PickingOrderMap
): T | null {
  const inStock = rows.filter(
    (r) => r.sku === sku && r.warehouse === warehouse && (r.quantity ?? 0) > 0
  );
  if (inStock.length === 0) return null;
  return [...inStock].sort(byPickPreference(pickingOrder))[0];
}
