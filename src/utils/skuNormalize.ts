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
