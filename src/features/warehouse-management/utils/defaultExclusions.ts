// Model families excluded from the Overstock put-away plan by default —
// confirmed with Rafael from real floor knowledge, not derivable from
// sku_metadata (width_in is mostly a placeholder default, see
// docs/overstock-putaway-plan.md).
//
//  - Wide box: Faultline, Hardline, Dragon, Portal, Taxi Trike — physically
//    too wide for the tower/line layout in this block.
//  - Juvenile: JUV-tagged models + the small-wheel lines that don't carry
//    the JUV tag (Taxi 16", bare XR.26) — too small to make sense here.
//
// This is a starting point, not a rigid rule — overridable per-SKU via
// useSkuOverrides (the Filters panel checkbox).

const WIDE_BOX_PATTERNS = [
  /\bFAULTLINE\b/i,
  /\bHARDLINE\b/i,
  /\bDRAGON\b/i,
  /\bPORTAL\b/i,
  /\bTAXI\s*TRIKE\b/i,
];

const JUVENILE_PATTERNS = [/\bJUV\b/i, /\bTAXI\s*16\b/i, /\bXR\.?\s*26\b/i];

export type DefaultExclusionReason = 'wide box' | 'juvenile';

export function defaultExclusionReason(itemName: string | null): DefaultExclusionReason | null {
  if (!itemName) return null;
  if (WIDE_BOX_PATTERNS.some((re) => re.test(itemName))) return 'wide box';
  if (JUVENILE_PATTERNS.some((re) => re.test(itemName))) return 'juvenile';
  return null;
}
