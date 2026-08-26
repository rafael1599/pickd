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
 * Bike catalog SKU with at most ONE trailing finish/variant letter beyond the
 * 2-letter color: `03-3768BL`, `03-3768BLD`. Group 1 is the family base.
 */
const VARIANT_SIBLING_RE = /^(\d{2}-\d{4}[A-Z]{2})[A-Z]?$/;

/**
 * Family base of a bike SKU — dept + number + 2-letter color — or null when
 * the SKU is not that shape (parts, UPCs, longer codes, mangled input).
 *
 * `03-3768BL` and `03-3768BLD` are the SAME bike. The AS400 PDF prints the
 * finish letter on some lines, and the catalog keeps both names alive because
 * the operator renames the inventory row between them (3 times in 2026) and
 * the old `sku_metadata` row cannot be deleted — qty-0 inventory rows
 * reference it. So "which name holds the stock" is a fact about this month,
 * not about the SKU: anything that has to find that bike's stock must look at
 * the whole family and let stock decide. {@link isVariantSibling} is the
 * membership test; the watcher applies the same rule at intake.
 * Case-sensitive on purpose, like every other catalog match in this module.
 */
export function variantSiblingBase(sku: string | null | undefined): string | null {
  const m = VARIANT_SIBLING_RE.exec((sku || '').trim());
  return m ? m[1] : null;
}

/** True when `a` and `b` are two different catalog names of the same bike. */
export function isVariantSibling(
  a: string | null | undefined,
  b: string | null | undefined
): boolean {
  const sa = (a || '').trim();
  const sb = (b || '').trim();
  const base = variantSiblingBase(sa);
  return base !== null && sa !== sb && variantSiblingBase(sb) === base;
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
 * Every inventory SKU worth trying for an order SKU, best guess first.
 *
 * The dash is the reason this exists. The watcher reads "03 4664 BR" off the
 * PDF and can emit it collapsed to "034664BR", which matches no inventory row,
 * so the picker fixes it by hand — a quarter of every replacement logged in
 * five months is someone re-typing a SKU that differs only by that character.
 *
 * It cannot simply be inserted: eight SKUs really are stored without one, four
 * of them holding live stock (700106BK, 860005BK…), and dashing those would
 * break picks that work today. So this keeps the fallback contract the rest of
 * the module follows — the exact SKU is always first, the dashed form is only
 * ever a later guess, and the caller takes the first candidate that actually
 * has stock.
 */
export function inventorySkuCandidates(sku: string | null | undefined): string[] {
  const exact = (sku || '').trim();
  if (!exact) return [];

  const dashed = normalizeSkuOnRegister(exact);
  const ordered = [exact, resolveInventorySku(exact), dashed, resolveInventorySku(dashed)];

  return [...new Set(ordered.filter(Boolean))];
}

/**
 * Out-of-stock SUBSTITUTES — hand-written equivalences where an ordered SKU
 * should be REPLACED by a different, genuinely distinct product when the
 * ordered one runs dry (e.g. a prior model year accepted as a stand-in). This
 * is a different relationship from {@link AS400_SKU_ALIASES} and from variant
 * siblings ({@link variantSiblingBase}):
 *
 *  - AS400 alias     → SAME bike under a different AS400 code. Keep the order
 *    SKU, just point the UI at where the stock lives (warning chip).
 *  - Variant sibling → SAME bike under two catalog names that differ only by a
 *    trailing finish letter (03-3768BL / 03-3768BLD). Resolved by STOCK, in
 *    both directions, never listed here — see below.
 *  - Substitute      → a DIFFERENT product. The order SKU is swapped so the
 *    paperwork/labels reflect what physically ships.
 *
 * Directional: key = ordered SKU that runs dry, value = preferred replacement.
 * Edit Order auto-applies the swap when the replacement has enough stock
 * (tier 1 in CorrectionModeView) and offers Undo. Kept by hand on purpose: an
 * entry is a standing product decision, not something read off inventory.
 *
 * Why the map is empty today: it held 03-3768BL → 03-3768BLD and
 * 03-3769BL → 03-3769BLD, written when the stock sat under the BLD rows. Those
 * pairs are the same bike, and which row holds the stock flips every time the
 * operator renames the inventory row (last 2026-08-25, which turned the 3768
 * entry backwards overnight). A map entry also made tier 2 skip the item
 * ("tier 1 owns these"), so a stale entry left the picker with the LOW STOCK
 * flag and no suggestion at all while 145 units sat on ROW 43. A stock-derived
 * rule is exactly right for siblings — it is one bike — and exactly wrong for
 * real substitutes, which is why the two live apart.
 */
export const SKU_SUBSTITUTES: Record<string, string> = {};

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

/**
 * Registration-time SKU normalizer. Operators never have to type the dash that
 * separates the 2-digit department code from the rest — it is inserted
 * automatically when a new SKU is registered from the UI ("033768BLD" →
 * "03-3768BLD"). Also trims, uppercases and strips internal whitespace.
 *
 * Scoped to bike-style catalog SKUs: it only acts when the SKU starts with two
 * digits, has no dash right after them, AND contains at least one letter (the
 * color/finish code). Pure-numeric codes — UPCs and numeric part numbers like
 * "128353" — are left untouched, as are SKUs that already carry the dash or
 * don't start with two digits.
 */
export function normalizeSkuOnRegister(raw: string | null | undefined): string {
  const s = (raw || '').trim().toUpperCase().replace(/\s+/g, '');
  return /^\d{2}[^-]/.test(s) && /[A-Z]/.test(s) ? `${s.slice(0, 2)}-${s.slice(2)}` : s;
}
