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

/**
 * Out-of-stock SUBSTITUTES — hardcoded equivalences where an ordered SKU should
 * be REPLACED by a different, genuinely distinct SKU when the ordered one runs
 * dry. This is a different relationship from {@link AS400_SKU_ALIASES}:
 *
 *  - AS400 alias  → SAME physical bike under a different AS400 code. Keep the
 *    order SKU, just point the UI at where the stock lives (warning chip).
 *  - Substitute   → a DIFFERENT product accepted as a stand-in (e.g. the prior
 *    model year). The order SKU is actually swapped so the paperwork/labels
 *    reflect what physically ships.
 *
 * Directional: key = ordered SKU that runs dry, value = preferred replacement
 * that holds the stock. Grow this map as equivalences are discovered in the
 * field. Edit Order auto-applies the swap when the replacement has enough stock
 * (see CorrectionModeView), and offers Undo.
 *
 * Seed: 03-3768BL (DIVIDE S/O 12X27 2026 RIPTIDE, routinely 0 stock) →
 *       03-3768BLD (DIVIDE S/O 12X27 2025 RIPTIDE, where the units actually are).
 */
export const SKU_SUBSTITUTES: Record<string, string> = {
  '03-3768BL': '03-3768BLD',
};

/**
 * Returns the hardcoded substitute for an out-of-stock order SKU, or null when
 * there is none. De-mangles the spurious trailing letter first (same fallback
 * contract as {@link resolveInventorySku}) so a watcher-mangled SKU still hits
 * the map. Never returns the input SKU itself.
 */
export function getSubstituteSku(sku: string | null | undefined): string | null {
  const s = (sku || '').trim();
  if (!s) return null;
  const sub = SKU_SUBSTITUTES[s] ?? SKU_SUBSTITUTES[canonicalBikeSku(s)] ?? null;
  return sub && sub !== s ? sub : null;
}
