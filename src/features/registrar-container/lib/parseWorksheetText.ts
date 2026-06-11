// Pure parser for a JAMIS "Purchase Order Worksheet" PDF (e.g. Oyama Factory).
//
// Layout (one line per received part):
//   PO #: 6430N
//   RECEIVED QTY  SKU            Size/Description
//   75  12 - 8341 BL  Taxi Part Chainguard 24"
//   100 12 - 8314     Taxi Part Crank Arm 26/24"   (no color)
//
// SKU is rebuilt as `${prefix}-${number}${color}` -> "12-8341BL" / "12-8314",
// matching the canonical dashed form used everywhere else. This function takes
// already-extracted text (newline-joined) so it is testable without a PDF engine;
// parseShipmentPdf supplies the text via pdfjs.

import type { ParsedLine, ParsedSheet } from './types';

const PO_RE = /PO\s*#?\s*:?\s*([0-9]{3,5}[A-Z]?)/i;

// qty | prefix(1-2 digits) | '-' | number(3-5 digits) | optional color(1-3 CAPS) | name
// The optional color only matches an all-caps token (BL/BK/KW…); a name like
// "Taxi Part" starts with a mixed-case word, so it is never mistaken for a color.
const ITEM_RE = /^(\d+)\s+(\d{1,2})\s*-\s*(\d{3,5})\s+(?:([A-Z]{1,3})\s+)?(\S.*)$/;

function buildSku(prefix: string, number: string, color: string | undefined): string {
  const p = prefix.replace(/\D/g, '').padStart(2, '0');
  const n = number.replace(/\D/g, '');
  const c = (color ?? '').trim().toUpperCase();
  return `${p}-${n}${c}`;
}

/** Parse the worksheet's extracted text into the same ParsedSheet shape the
 *  xlsx path produces. Returns a single sheet (a PDF worksheet is one section). */
export function parseWorksheetText(text: string, sheetName = 'PO worksheet'): ParsedSheet {
  const po = text.match(PO_RE)?.[1] ?? null;
  const items: ParsedLine[] = [];

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    const m = ITEM_RE.exec(line);
    if (!m) continue;
    const [, qtyStr, prefix, number, color, name] = m;
    const qty = Number(qtyStr);
    if (!Number.isFinite(qty) || qty <= 0) continue; // skip the totals/notes row (qty 0)
    items.push({ po, sku: buildSku(prefix, number, color), qty, itemName: name.trim() });
  }

  return {
    name: po ? `PO ${po}` : sheetName,
    items,
    total: items.reduce((sum, i) => sum + i.qty, 0),
  };
}
