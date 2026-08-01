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
 *
 * `requiredQty` is what keeps those two rules from fighting. Preference alone
 * would answer "the reachable shelf" even when it holds 17 against an order for
 * 20, and the caller only swaps on a row that covers the order — so the
 * substitution would quietly stop happening at all, and the picker would be
 * left with the out-of-stock flag and no suggestion. Given the quantity, a
 * covering shelf is looked for in preference order first, and the buried pallet
 * is still reached for when it is the only thing that can finish the job.
 */
export function pickBestStockRow<T extends StockRow>(
  rows: T[],
  sku: string,
  warehouse: string,
  pickingOrder?: PickingOrderMap,
  requiredQty?: number
): T | null {
  const inStock = rows.filter(
    (r) => r.sku === sku && r.warehouse === warehouse && (r.quantity ?? 0) > 0
  );
  if (inStock.length === 0) return null;

  const ranked = [...inStock].sort(byPickPreference(pickingOrder));

  const needed = Math.max(0, Math.trunc(Number(requiredQty) || 0));
  if (needed > 0) {
    const covers = ranked.find((r) => (r.quantity ?? 0) >= needed);
    if (covers) return covers;
  }

  return ranked[0];
}
