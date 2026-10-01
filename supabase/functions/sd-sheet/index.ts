// Edge function: sd-sheet — the S/D bikes in stock, for the Google Sheet that
// mirrors them (Rafael, 1 Oct 2026). Apps Script in the sheet calls this every
// minute and rewrites its tab; nothing in the sheet is written by hand.
//
// No Supabase JWT (the caller is Apps Script): the gateway check is OFF in
// config.toml and the request must carry the shared secret SD_SHEET_TOKEN in
// the `x-sheet-token` header. The rows carry serials and internal notes.
//
// Rows and order: copied from src/features/inventory/utils/scratchDentExport.ts
// (live stock in LUDLOW, numbered first by #, then location, then SKU); if the
// rule changes there, change it here.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const COLUMNS = [
  'SD #',
  'SKU',
  'Name',
  'Category',
  'Condition',
  'Condition description',
  'Serial',
  'Location',
  'Internal note',
  'AS400 description',
  'Photo',
  'PDF link',
] as const;

interface Shelf {
  warehouse: string | null;
  location: string | null;
  sublocation: string[] | null;
  quantity: number | null;
  is_active: boolean | null;
  item_name: string | null;
  internal_note: string | null;
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });

serve(async (req: Request) => {
  const secret = Deno.env.get('SD_SHEET_TOKEN');
  if (!secret || req.headers.get('x-sheet-token') !== secret) {
    return json({ error: 'unauthorized' }, 401);
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );

  const { data, error } = await supabase
    .from('sku_metadata')
    .select(
      `sku, sd_number, category, condition, condition_description, serial_number,
       as400_description, image_url, pdf_link,
       inventory!left ( warehouse, location, sublocation, quantity, is_active,
         item_name, internal_note )`
    )
    .eq('is_scratch_dent', true)
    .range(0, 9999);
  if (error) return json({ error: error.message }, 500);

  const rows: { n: number; loc: string; sku: string; values: (string | number)[] }[] = [];
  for (const m of data ?? []) {
    for (const inv of (m.inventory ?? []) as Shelf[]) {
      if ((inv.warehouse ?? 'LUDLOW') !== 'LUDLOW') continue;
      if (inv.is_active === false || (inv.quantity ?? 0) <= 0) continue;
      const square = inv.sublocation?.length ? ` ${[...inv.sublocation].sort().join('')}` : '';
      const loc = `${inv.location ?? ''}${square}`;
      rows.push({
        n: m.sd_number ?? Number.POSITIVE_INFINITY,
        loc,
        sku: m.sku,
        values: [
          m.sd_number ?? '',
          m.sku,
          inv.item_name ?? '',
          m.category ?? '',
          m.condition ?? '',
          m.condition_description ?? '',
          m.serial_number ?? '',
          loc,
          inv.internal_note ?? '',
          m.as400_description ?? '',
          m.image_url ?? '',
          m.pdf_link ?? '',
        ],
      });
    }
  }
  rows.sort(
    (a, b) =>
      a.n - b.n ||
      a.loc.localeCompare(b.loc, undefined, { numeric: true }) ||
      a.sku.localeCompare(b.sku, undefined, { numeric: true })
  );

  return json({ columns: COLUMNS, rows: rows.map((r) => r.values), at: new Date().toISOString() });
});
