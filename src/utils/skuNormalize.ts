/**
 * Bike SKUs use a 2-letter color code: `\d{2}-\d{4}[A-Z]{2}` (e.g. "03-3768BL").
 * The watcher sometimes appends a spurious extra trailing letter when parsing
 * the PDF (e.g. it grabs the first letter of the description "DIVIDE" → produces
 * "03-3768BLD"). That mangled SKU then fails to match inventory and the item is
 * flagged sku_not_found.
 *
 * `canonicalBikeSku` strips trailing letters beyond the canonical 2 so the SKU
 * matches inventory again. SKUs that don't fit the bike pattern (parts, UPCs,
 * etc.) are returned unchanged.
 *
 * NOTE: intended as a *fallback* — try the exact SKU first, and only fall back to
 * the canonical form when the exact SKU isn't found. That way a legitimate SKU
 * that really exists as-is is never altered.
 */
export function canonicalBikeSku(sku: string | null | undefined): string {
  const s = (sku || '').trim();
  const m = /^(\d{2}-\d{4}[A-Za-z]{2})[A-Za-z]+$/.exec(s);
  return m ? m[1] : s;
}

/**
 * Explicit AS400 → inventory SKU aliases. AS400 catalogs a handful of SKUs
 * under a different color code than the one the physical inventory uses
 * (e.g. AS400 sells 03-4070BL but the bike PickD stocks is 03-4070BK), so the
 * mapping can't be derived from the SKU shape like the mangled-suffix case.
 * Orders keep the AS400 SKU — the alias only tells the UI which inventory SKU
 * actually holds the stock, and the Double-Check view shows a warning chip.
 */
export const AS400_SKU_ALIASES: Record<string, string> = {
  '03-4070BL': '03-4070BK',
};

/**
 * Inventory-facing form of an order SKU: de-mangles the spurious trailing
 * letter, then applies the explicit AS400 alias if there is one. Same
 * fallback contract as {@link canonicalBikeSku}: try the exact SKU first.
 */
export function resolveInventorySku(sku: string | null | undefined): string {
  const canon = canonicalBikeSku(sku);
  return AS400_SKU_ALIASES[canon] ?? canon;
}
