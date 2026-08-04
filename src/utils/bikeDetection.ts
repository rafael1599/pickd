import { supabase } from '../lib/supabase';

/**
 * Synchronous bike detection helper: checks if `is_bike` flag is true,
 * or if the SKU prefix belongs to any known bike series ('01', '02', '03', '06', '07').
 */
export function isBikeSku(
  sku?: string | null,
  skuMetadata?: { is_bike?: boolean | null } | null
): boolean {
  if (typeof skuMetadata?.is_bike === 'boolean') {
    return skuMetadata.is_bike;
  }
  if (!sku) return false;
  const clean = sku.trim().replace(/[^a-zA-Z0-9]/g, '');
  const prefix = clean.slice(0, 2);
  return ['01', '02', '03', '06', '07'].includes(prefix);
}

/**
 * Synchronous heuristic: every cataloged bike SKU (prefixes 01, 02, 03, 06, 07 or is_bike)
 * is recognized immediately, before the metadata fetch resolves.
 */
export function inferBikeSkusByPrefix(skus: string[]): Set<string> {
  return new Set(skus.filter((s) => isBikeSku(s)));
}

/**
 * Authoritative bike detection for a list of SKUs: the prefix seed plus
 * `sku_metadata.is_bike`. Returns the set of SKUs that are bikes. On fetch
 * failure it falls back to the prefix seed so cataloged bikes are still
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
    if (row.is_bike) {
      result.add(row.sku);
    } else if (row.is_bike === false) {
      result.delete(row.sku); // Explicitly NOT a bike in DB
    }
  });
  return result;
}
