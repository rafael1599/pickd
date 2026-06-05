import { supabase } from '../lib/supabase';

/**
 * Synchronous heuristic: every cataloged "03-" SKU is a bike (`is_bike = true`),
 * so we can seed bike-awareness immediately, before the metadata fetch resolves.
 * Used as the initial value while {@link resolveBikeSkuSet} loads.
 */
export function inferBikeSkusByPrefix(skus: string[]): Set<string> {
  return new Set(skus.filter((s) => s && s.startsWith('03-')));
}

/**
 * Authoritative bike detection for a list of SKUs: the "03-" prefix seed plus
 * `sku_metadata.is_bike`. Returns the set of SKUs that are bikes. On fetch
 * failure it falls back to the prefix seed so cataloged "03-" bikes are still
 * recognized.
 *
 * Used so pallet math can tell bikes (paginate by capacity) from parts
 * (consolidate into one pallet) — see `calculatePalletsWithBikeAwareness`.
 */
export async function resolveBikeSkuSet(skus: string[]): Promise<Set<string>> {
  const unique = Array.from(new Set(skus.filter(Boolean)));
  const result = inferBikeSkusByPrefix(unique);
  if (unique.length === 0) return result;

  const { data, error } = await supabase
    .from('sku_metadata')
    .select('sku, is_bike')
    .in('sku', unique);

  if (error || !data) return result;

  (data as { sku: string; is_bike: boolean | null }[]).forEach((row) => {
    if (row.is_bike) result.add(row.sku);
  });
  return result;
}
