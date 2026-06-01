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

import * as XLSX from 'xlsx';
import type { ParsedLine, ParsedSheet } from './types';

type Cell = string | number | boolean | null | undefined;
type Row = Cell[];

function buildSku(prefix: Cell, number: Cell, color: Cell): string {
  const p = String(prefix ?? '')
    .replace(/\D/g, '')
    .padStart(2, '0');
  const n = String(number ?? '').replace(/\D/g, '');
  const c = color == null ? '' : String(color).trim().toUpperCase();
  return `${p}-${n}${c}`;
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

function parseSheetRows(rows: Row[]): ParsedLine[] {
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
    const itemName = [f, g, h]
      .filter((x) => x != null && String(x).trim() !== '')
      .map((x) => String(x).trim())
      .join(' ');

    items.push({ po: currentPo, sku, qty, itemName });
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
