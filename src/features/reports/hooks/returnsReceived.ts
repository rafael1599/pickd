import { supabase } from '../../../lib/supabase';
import type { FedExReturnSummary } from './useActivityReport';

/**
 * FedEx returns that landed in [from, to] (idea-091), read from their own
 * unit since idea-250: a return is a `sku_metadata` row with `unit_kind =
 * 'return'`, its SKU the tracking, created the moment it was registered. One
 * return is one box.
 */
export async function fetchReturnsReceived(
  fromIso: string,
  toIso: string,
  limit: number
): Promise<FedExReturnSummary[]> {
  const { data, error } = await supabase
    .from('sku_metadata')
    .select('sku, rma')
    .eq('unit_kind', 'return')
    .gte('created_at', fromIso)
    .lte('created_at', toIso)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []).map((r) => ({ tracking_number: r.sku, rma: r.rma ?? null, total_qty: 1 }));
}
