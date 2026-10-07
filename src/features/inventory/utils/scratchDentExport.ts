/**
 * The S/D bikes as a spreadsheet: one row per unit on a shelf, with every
 * column PickD holds about it — the catalogue (`sku_metadata`) and the shelf
 * row (`inventory`) side by side.
 *
 * It mirrors the Stock view's S/D filter: LUDLOW, live stock only, and with
 * "Deleted & Qty 0" ticked also the units already gone (a S/D SKU is one bike,
 * so qty 0 means sold). A catalogue row with no shelf row at all only shows up
 * in that second mode — it never had a place to be.
 *
 * Pure on purpose: the fetch lives in `inventoryApi.fetchScratchDentExport`.
 */

import { sdCode } from '../../../utils/sdCode';

export interface ScratchDentInventoryRow {
  id: number;
  warehouse: string | null;
  location: string | null;
  quantity: number | null;
  is_active: boolean | null;
  item_name: string | null;
  internal_note: string | null;
}

export interface ScratchDentMetadataRow {
  sku: string;
  /** The #n printed next to its label; null until its first print. */
  sd_number: number | null;
  category: string | null;
  condition: string | null;
  condition_description: string | null;
  /** yes | not_yet | no — whether it can be sold. A notice; blocks nothing. */
  sd_for_sale: string | null;
  serial_number: string | null;
  upc: string | null;
  msrp: number | null;
  standard_price: number | null;
  sd_price: number | null;
  as400_description: string | null;
  image_url: string | null;
  pdf_link: string | null;
  inventory?: ScratchDentInventoryRow[] | null;
}

export type ScratchDentExportRow = Record<string, string | number>;

const WAREHOUSE = 'LUDLOW';

const isLive = (inv: ScratchDentInventoryRow) => inv.is_active !== false && (inv.quantity ?? 0) > 0;

const num = (v: number | null | undefined) => (v == null ? '' : Number(v));

// Same labels as sd_sheet_options() / sd_for_sale_label() in SQL and
// SD_FOR_SALE_OPTIONS in SdDetailsCard.tsx; if one changes, change the others.
const FOR_SALE_LABEL: Record<string, string> = { yes: 'Yes', not_yet: 'Not yet', no: 'No' };
export const forSaleLabel = (v: string | null | undefined) => (v ? (FOR_SALE_LABEL[v] ?? v) : '');

function buildRow(m: ScratchDentMetadataRow, inv: ScratchDentInventoryRow | null) {
  const qty = inv?.quantity ?? 0;
  return {
    // Up to 99 a plain number, as before; past it the code (1A …).
    'SD #': m.sd_number == null ? '' : m.sd_number <= 99 ? m.sd_number : sdCode(m.sd_number),
    SKU: m.sku,
    // The full name already carries model, size and colour (and ends in SD),
    // so the sheet shows it alone instead of the parts next to it.
    Name: inv?.item_name ?? '',
    // Right after the name: it is the first thing whoever sells from the sheet needs.
    'For sale': forSaleLabel(m.sd_for_sale),
    Category: m.category ?? '',
    Condition: m.condition ?? '',
    'Condition description': m.condition_description ?? '',
    Serial: m.serial_number ?? '',
    UPC: m.upc ?? '',
    MSRP: num(m.msrp),
    'Standard price': num(m.standard_price),
    'S/D price': num(m.sd_price),
    Location: inv?.location ?? '',
    Qty: qty,
    Status: inv && isLive(inv) ? 'In stock' : 'Sold / 0',
    'Internal note': inv?.internal_note ?? '',
    'AS400 description': m.as400_description ?? '',
    Photo: m.image_url ?? '',
    'PDF link': m.pdf_link ?? '',
  } satisfies ScratchDentExportRow;
}

export function buildScratchDentExportRows(
  metadata: ScratchDentMetadataRow[],
  { includeInactive }: { includeInactive: boolean }
): ScratchDentExportRow[] {
  const rows: Array<{ n: number | null; loc: string; row: ScratchDentExportRow }> = [];
  for (const m of metadata) {
    const shelf = (m.inventory ?? []).filter((inv) => (inv.warehouse ?? WAREHOUSE) === WAREHOUSE);
    const kept = includeInactive ? shelf : shelf.filter(isLive);
    if (kept.length === 0) {
      if (includeInactive && (m.inventory ?? []).length === 0)
        rows.push({ n: m.sd_number, loc: '', row: buildRow(m, null) });
      continue;
    }
    for (const inv of kept)
      rows.push({ n: m.sd_number, loc: inv.location ?? '', row: buildRow(m, inv) });
  }
  // Numbered bikes first, lowest # first (Rafael, 30 Sep 2026: the sheet
  // opens on the lowest number); the rest in the floor's reading order, by
  // location and then SKU.
  // The column shows the code (1A …); the order is the number behind it.
  const sdNumber = (r: { n: number | null }) => r.n ?? Number.POSITIVE_INFINITY;
  return rows
    .sort(
      (a, b) =>
        sdNumber(a) - sdNumber(b) ||
        a.loc.localeCompare(b.loc, undefined, { numeric: true }) ||
        String(a.row.SKU).localeCompare(String(b.row.SKU), undefined, { numeric: true })
    )
    .map((r) => r.row);
}

export const scratchDentExportFileName = (now = new Date()) => {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `SD_BIKES_${y}${m}${d}.xlsx`;
};
