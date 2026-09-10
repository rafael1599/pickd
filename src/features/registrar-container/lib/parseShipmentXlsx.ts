// Parser for JAMIS "Shipment Schedule" xlsx breakdown sheets.
//
// Relevant sheets (NJ Breakdown / FL Breakdown / Direct Containers) share a
// layout where the SKU is split across 3 columns and the quantity lives in
// "Units Inv'd":
//   A: (PO marker on section rows)   B: Units Inv'd (qty)
//   C: prefix (e.g. "03")            D: number (e.g. 3986)   E: color (e.g. "TL")
//   F: Model   G: Size   H: Color name
//
// Each container opens with a section row: the PO in A, the vessel in D (B on
// the FL sheet) and the container number in F --
//   ["7005N", " ", " ", "EVER BIRTH", null, "TXGU5768052"]
// -- and its lines follow until the next one. A sheet is as many containers as
// it has section rows, which is why the file is read container by container
// and not sheet by sheet (lib/containers.ts).
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
import type { ParsedContainer, ParsedLine } from './types';
import { groupContainers } from './containers';
import { normalizeSkuOnRegister } from '../../../utils/skuNormalize';

type Cell = string | number | boolean | null | undefined;
type Row = Cell[];

// '7005N' (Jamis North), '6438F' (Jamis South), '6433FL' (Direct Containers).
const PO_RE = /^\d{3,5}[A-Z]{1,2}$/i;

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

/** The section row that opens a container, or null for any other row. */
function sectionHeader(r: Row): Pick<ParsedContainer, 'po' | 'vessel' | 'containerIds'> | null {
  const po = text(r[0]);
  if (po == null || !PO_RE.test(po)) return null;
  const containerId = text(r[5]);
  return {
    po: po.toUpperCase(),
    vessel: text(r[3]) ?? text(r[1]),
    containerIds: containerId ? [containerId] : [],
  };
}

/** One line item, or null for headers, notes and the totals row. */
function lineItem(r: Row, po: string | null): ParsedLine | null {
  const [, b, c, d, e, f, g, h] = r;
  const qty = toQty(b);
  const prefixOk = c != null && /^\d{1,2}$/.test(String(c).trim());
  const numOk = d != null && String(d).replace(/\D/g, '') !== '';
  if (qty == null || qty <= 0 || !prefixOk || !numOk) return null;

  const model = text(f);
  const size = text(g);
  const color = text(h);
  const itemName = [model, size, color].filter(Boolean).join(' ');
  return { po, sku: buildSku(c, d, e), qty, itemName, model, size, color };
}

/**
 * The containers of one breakdown sheet, in the order the sheet lists them.
 * Lines above the first section row (a sheet somebody trimmed by hand) form a
 * container of their own with no PO.
 *
 * Exported for the tests: the layout is the contract, and a fixture of rows
 * exercises it without a binary workbook to maintain.
 */
export function parseSheetContainers(rows: Row[], sheet: string): ParsedContainer[] {
  const containers: ParsedContainer[] = [];
  let current: ParsedContainer | null = null;

  for (const r of rows) {
    const header = sectionHeader(r);
    if (header) {
      current = { ...header, sheet, items: [], total: 0 };
      containers.push(current);
      continue;
    }
    const line = lineItem(r, current?.po ?? null);
    if (!line) continue;
    if (!current) {
      current = { po: null, sheet, vessel: null, containerIds: [], items: [], total: 0 };
      containers.push(current);
    }
    current.items.push(line);
    current.total += line.qty;
  }
  return containers;
}

/** The line items of one breakdown sheet, each tagged with its PO. */
export function parseSheetRows(rows: Row[]): ParsedLine[] {
  return parseSheetContainers(rows, '').flatMap((c) => c.items);
}

/** Parse a File (xlsx) into every container its breakdown sheets list. */
export async function parseShipmentXlsx(file: File): Promise<ParsedContainer[]> {
  const buffer = await file.arrayBuffer();
  const wb = XLSX.read(buffer, { type: 'array' });
  const sections: ParsedContainer[] = [];

  for (const name of wb.SheetNames) {
    const ws = wb.Sheets[name];
    const rows = XLSX.utils.sheet_to_json<Row>(ws, {
      header: 1,
      raw: true,
      defval: null,
    });
    if (!isBreakdownLayout(rows)) continue;
    sections.push(...parseSheetContainers(rows, name));
  }
  return groupContainers(sections);
}
