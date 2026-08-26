/**
 * Stock-aware substitution helpers for Edit Order.
 *
 * When an ordered SKU runs out of stock, PickD can resolve it to an equivalent
 * SKU that DOES have stock — a variant sibling (the same bike under another
 * catalog name, see pickVariantSiblingRow) or a hardcoded substitute (see
 * SKU_SUBSTITUTES in utils/skuNormalize), both auto-applied on open, or a
 * same-model sibling surfaced as a one-tap suggestion (see findSimilarSkus).
 * This module holds the pure, testable piece: choosing the best in-stock row.
 */

import { isVariantSibling } from '../../../utils/skuNormalize';
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

/**
 * Best in-stock row among the VARIANT SIBLINGS of `sku` — the other catalog
 * names of the same bike (`03-3768BLD` → `03-3768BL`, and back). Returns null
 * when no sibling in `warehouse` carries stock. Never returns a row of `sku`
 * itself: the caller already knows that one is dry.
 *
 * Ranking is the one every other pick uses ({@link pickBestStockRow}): each
 * sibling's best shelf is found first, then a shelf that covers `requiredQty`
 * wins in pick-preference order, else the fullest reachable one. Which name
 * holds the stock changes with operator renames, so this is derived from
 * inventory on purpose — see SKU_SUBSTITUTES in utils/skuNormalize for why the
 * hand map is not.
 */
export function pickVariantSiblingRow<T extends StockRow>(
  rows: T[],
  sku: string,
  warehouse: string,
  pickingOrder?: PickingOrderMap,
  requiredQty?: number
): T | null {
  const siblings = [...new Set(rows.filter((r) => isVariantSibling(sku, r.sku)).map((r) => r.sku))];
  const bests = siblings
    .map((s) => pickBestStockRow(rows, s, warehouse, pickingOrder, requiredQty))
    .filter((r): r is T => r !== null);
  if (bests.length === 0) return null;

  const ranked = bests.sort(byPickPreference(pickingOrder));
  const needed = Math.max(0, Math.trunc(Number(requiredQty) || 0));
  if (needed > 0) {
    const covers = ranked.find((r) => (r.quantity ?? 0) >= needed);
    if (covers) return covers;
  }
  return ranked[0];
}
