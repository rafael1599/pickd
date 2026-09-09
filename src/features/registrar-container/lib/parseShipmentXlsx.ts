// Parser for JAMIS "Shipment Schedule" xlsx breakdown sheets.
//
// Relevant sheets (NJ Breakdown / FL Breakdown / Direct Containers) share a
// layout where the SKU is split across 3 columns and the quantity lives in
// "Units Inv'd":
//   A: (PO marker on section rows)   B: Units Inv'd (qty)
//   C: prefix (e.g. "03")            D: number (e.g. 3986)   E: color (e.g. "TL")
//   F: Model   G: Size   H: Color name
//
// SKU is rebuilt as `${prefix}-${number}${color}` -> "03-3986TL", matching the
// canonical dashed form used elsewhere in the app.
//
// F/G/H are kept apart as well as joined. `itemName` is the label a person
// reads on a card; model / size / color are the three fields sku_metadata has
// columns for, and the sheet has already split them. Joining them and hoping
// something downstream can tell "Laser 1.6" from "Gloss Black" is how the
// September container landed with six bikes whose model was NULL -- which put
// them in the measuring queue for good, since a carton FedEx cannot name is
// held back however many times it is measured (utils/fedexCarton).

import * as XLSX from 'xlsx';
import type { ParsedLine, ParsedSheet } from './types';
import { normalizeSkuOnRegister } from '../../../utils/skuNormalize';

type Cell = string | number | boolean | null | undefined;
type Row = Cell[];

function buildSku(prefix: Cell, number: Cell, color: Cell): string {
  const p = String(prefix ?? '')
    .replace(/\D/g, '')
    .padStart(2, '0');
  const n = String(number ?? '').replace(/\D/g, '');
  const c = color == null ? '' : String(color).trim().toUpperCase();
  // Excel drops the leading zero of a numeric cell (0077 → 77); the canonical
  // rule pads it back (idea-154).
  return normalizeSkuOnRegister(`${p}-${n}${c}`);
}

function toQty(value: Cell): number | null {
  if (typeof value === 'number') return value;
  const s = String(value ?? '').trim();
  if (s === '' || Number.isNaN(Number(s))) return null;
  return Number(s);
}

/** A sheet is a breakdown sheet if any cell literally reads "SKU #". */
function isBreakdownLayout(rows: Row[]): boolean {
  return rows.some((r) => r.some((c) => String(c ?? '').trim() === 'SKU #'));
}

/** A cell as a trimmed string, or null when the sheet left it empty. */
function text(cell: Cell): string | null {
  const s = String(cell ?? '').trim();
  return s === '' ? null : s;
}

/**
 * The line items of one breakdown sheet.
 *
 * Exported for the tests: the layout is the contract, and a fixture of rows
 * exercises it without a binary workbook to maintain.
 */
export function parseSheetRows(rows: Row[]): ParsedLine[] {
  const items: ParsedLine[] = [];
  let currentPo: string | null = null;

  for (const r of rows) {
    const [a, b, c, d, e, f, g, h] = r;

    // Section header row: col A like "6430N" (PO marker).
    if (a != null && /^\d{3,4}[A-Z]$/.test(String(a).trim())) {
      currentPo = String(a).trim();
      continue;
    }

    const qty = toQty(b);
    const prefixOk = c != null && /^\d{1,2}$/.test(String(c).trim());
    const numOk = d != null && String(d).replace(/\D/g, '') !== '';
    if (qty == null || qty <= 0 || !prefixOk || !numOk) continue;

    const sku = buildSku(c, d, e);
    const model = text(f);
    const size = text(g);
    const color = text(h);
    const itemName = [model, size, color].filter(Boolean).join(' ');

    items.push({ po: currentPo, sku, qty, itemName, model, size, color });
  }
  return items;
}

/** Parse a File (xlsx) and return every breakdown sheet that has line items. */
export async function parseShipmentXlsx(file: File): Promise<ParsedSheet[]> {
  const buffer = await file.arrayBuffer();
  const wb = XLSX.read(buffer, { type: 'array' });
  const sheets: ParsedSheet[] = [];

  for (const name of wb.SheetNames) {
    const ws = wb.Sheets[name];
    const rows = XLSX.utils.sheet_to_json<Row>(ws, {
      header: 1,
      raw: true,
      defval: null,
    });
    if (!isBreakdownLayout(rows)) continue;
    const items = parseSheetRows(rows);
    sheets.push({
      name,
      items,
      total: items.reduce((sum, i) => sum + i.qty, 0),
    });
  }
  return sheets;
}
