import type { LabelEntry } from '../hooks/useGenerateLabels';
import type { LabelLayout } from '../hooks/useLabelLayoutPreference';

/** What a SKU label reads from `sku_metadata`. */
export interface SkuLabelMetadata {
  color: string | null;
  size: string | null;
  model: string | null;
  upc: string | null;
  serial_number: string | null;
  category: string | null;
  is_bike: boolean | null;
}

/** Values typed in a form and not saved yet (Item Detail). A non-empty one wins. */
export interface SkuLabelOverrides {
  itemName?: string | null;
  model?: string | null;
  size?: string | null;
  color?: string | null;
  serialNumber?: string | null;
}

export interface SkuLabelRequest {
  sku: string;
  location: string | null;
  /** Units on hand — decides the tag status (`in_stock` vs `printed`). */
  stock: number;
  quantity: number;
  layout: LabelLayout;
  withQr: boolean;
  withBarcode: boolean;
  withUpc: boolean;
  overrides?: SkuLabelOverrides;
}

const filled = (v: string | null | undefined): string | null => {
  const t = v?.trim();
  return t ? t : null;
};

/**
 * The one label a SKU prints, whichever button printed it (idea-212, Rafael
 * 15 Sep 2026: "quiero que siempre imprima con el color y el upc es opcional").
 * Before this, every caller assembled its own entry: the Stock card read the
 * search row, which carries no color or size, so its label had neither, while
 * Item Detail's had color and no UPC.
 *
 * The UPC always goes onto the tag (it is data); `withUpc` only decides whether
 * it is printed.
 */
export function buildSkuLabelEntry(
  req: SkuLabelRequest,
  meta: SkuLabelMetadata | null,
  itemName: string | null
): LabelEntry {
  const o = req.overrides ?? {};
  return {
    sku: req.sku,
    itemName: filled(o.itemName) ?? filled(itemName),
    location: req.location,
    stock: req.stock,
    tagged: 0,
    qty: req.quantity,
    layout: req.layout,
    prefix: null,
    extra: null,
    upc: filled(meta?.upc),
    withUpc: req.withUpc,
    color: filled(o.color) ?? filled(meta?.color),
    model: filled(o.model) ?? filled(meta?.model),
    size: filled(o.size) ?? filled(meta?.size),
    category: meta?.category ?? null,
    isBike: meta?.is_bike ?? null,
    poNumber: null,
    cNumber: null,
    serialNumber: filled(o.serialNumber) ?? filled(meta?.serial_number),
    madeIn: null,
    otherNotes: null,
    withQr: req.withQr,
    withBarcode: req.withBarcode,
  };
}

/**
 * The name a label prints for a SKU: the one on the row being printed, else the
 * row holding the most units. Inventory rows of one SKU can carry different
 * spellings, and the printed row is the one the person is standing at.
 */
export function pickItemName(
  rows: { item_name: string | null; location: string | null; quantity: number | null }[],
  location: string | null
): string | null {
  const named = rows.filter((r) => filled(r.item_name));
  const here = location
    ? named.find((r) => r.location?.toUpperCase() === location.toUpperCase())
    : undefined;
  const best = here ?? [...named].sort((a, b) => (b.quantity ?? 0) - (a.quantity ?? 0))[0];
  return filled(best?.item_name);
}
