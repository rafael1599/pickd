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

export interface ScratchDentInventoryRow {
  id: number;
  warehouse: string | null;
  location: string | null;
  sublocation: string[] | null;
  quantity: number | null;
  is_active: boolean | null;
  item_name: string | null;
  internal_note: string | null;
}

export interface ScratchDentMetadataRow {
  sku: string;
  model: string | null;
  size: string | null;
  color: string | null;
  category: string | null;
  condition: string | null;
  condition_description: string | null;
  serial_number: string | null;
  upc: string | null;
  msrp: number | null;
  standard_price: number | null;
  sd_price: number | null;
  as400_description: string | null;
  received_year: number | null;
  image_url: string | null;
  pdf_link: string | null;
  inventory?: ScratchDentInventoryRow[] | null;
}

export type ScratchDentExportRow = Record<string, string | number>;

const WAREHOUSE = 'LUDLOW';

const isLive = (inv: ScratchDentInventoryRow) => inv.is_active !== false && (inv.quantity ?? 0) > 0;

const num = (v: number | null | undefined) => (v == null ? '' : Number(v));

function buildRow(m: ScratchDentMetadataRow, inv: ScratchDentInventoryRow | null) {
  const qty = inv?.quantity ?? 0;
  return {
    SKU: m.sku,
    Name: inv?.item_name ?? '',
    Model: m.model ?? '',
    Size: m.size ?? '',
    Color: m.color ?? '',
    Category: m.category ?? '',
    Condition: m.condition ?? '',
    'Condition description': m.condition_description ?? '',
    Serial: m.serial_number ?? '',
    UPC: m.upc ?? '',
    MSRP: num(m.msrp),
    'Standard price': num(m.standard_price),
    'S/D price': num(m.sd_price),
    Warehouse: inv?.warehouse ?? '',
    Location: inv?.location ?? '',
    Square: (inv?.sublocation ?? []).join(', '),
    Qty: qty,
    Status: inv && isLive(inv) ? 'In stock' : 'Sold / 0',
    'Internal note': inv?.internal_note ?? '',
    'AS400 description': m.as400_description ?? '',
    'Received year': num(m.received_year),
    Photo: m.image_url ?? '',
    'PDF link': m.pdf_link ?? '',
  } satisfies ScratchDentExportRow;
}

export function buildScratchDentExportRows(
  metadata: ScratchDentMetadataRow[],
  { includeInactive }: { includeInactive: boolean }
): ScratchDentExportRow[] {
  const rows: Array<{ loc: string; row: ScratchDentExportRow }> = [];
  for (const m of metadata) {
    const shelf = (m.inventory ?? []).filter((inv) => (inv.warehouse ?? WAREHOUSE) === WAREHOUSE);
    const kept = includeInactive ? shelf : shelf.filter(isLive);
    if (kept.length === 0) {
      if (includeInactive && (m.inventory ?? []).length === 0)
        rows.push({ loc: '', row: buildRow(m, null) });
      continue;
    }
    for (const inv of kept) rows.push({ loc: inv.location ?? '', row: buildRow(m, inv) });
  }
  // Same reading order as the floor: by location, then SKU.
  return rows
    .sort(
      (a, b) =>
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
