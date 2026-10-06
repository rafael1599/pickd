/**
 * The PH, S/D and FedEx-return units of the ordered bikes (idea-248 step 4).
 *
 * A special unit is its own article whose `base_sku` is the model, so the plan
 * of an order never sees it. Double Check asks for them only on a line that
 * came up short, to tell the picker one is there — never to send them to it.
 */
import { supabase } from '../../../lib/supabase';
import type { SpecialUnit } from '../utils/stockIssue';

const KINDS = ['sd', 'photo', 'return'] as const;

/** Units with stock, grouped by the ordered SKU they belong to. */
export async function fetchSpecialUnits(
  skus: string[],
  warehouse = 'LUDLOW'
): Promise<Record<string, SpecialUnit[]>> {
  const out: Record<string, SpecialUnit[]> = {};
  if (skus.length === 0) return out;

  const { data: metas, error } = await supabase
    .from('sku_metadata')
    .select('sku, base_sku, unit_kind')
    .in('base_sku', skus)
    .in('unit_kind', [...KINDS]);
  if (error) throw error;
  if (!metas || metas.length === 0) return out;

  const { data: rows, error: rowsError } = await supabase
    .from('inventory')
    .select('sku, location, quantity')
    .in(
      'sku',
      metas.map((m) => m.sku)
    )
    .eq('warehouse', warehouse)
    .gt('quantity', 0);
  if (rowsError) throw rowsError;

  for (const m of metas) {
    if (!m.base_sku) continue;
    for (const r of (rows ?? []).filter((x) => x.sku === m.sku)) {
      (out[m.base_sku] ??= []).push({
        sku: m.sku,
        kind: m.unit_kind as SpecialUnit['kind'],
        location: r.location,
        quantity: Number(r.quantity) || 0,
      });
    }
  }
  return out;
}
