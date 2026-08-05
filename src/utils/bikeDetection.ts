import { supabase } from '../lib/supabase';

/**
 * Canonical bike detection helper: checks if `is_bike` flag is true in `sku_metadata`.
 * Pure source of truth — prefix heuristics are eliminated. Accepts any combination:
 *   - isBikeSku(item)
 *   - isBikeSku(sku, skuMetadata)
 *   - isBikeSku(skuMetadata)
 */
export function isBikeSku(
  skuOrObj?:
    | string
    | { is_bike?: boolean | null; sku_metadata?: { is_bike?: boolean | null } | null }
    | null,
  skuMetadata?: { is_bike?: boolean | null } | null
): boolean {
  if (skuOrObj && typeof skuOrObj === 'object') {
    if ('sku_metadata' in skuOrObj && skuOrObj.sku_metadata) {
      return skuOrObj.sku_metadata.is_bike === true;
    }
    if ('is_bike' in skuOrObj) {
      return skuOrObj.is_bike === true;
    }
  }
  return skuMetadata?.is_bike === true;
}

/**
 * Authoritative bike detection for a list of SKUs: fetches `sku_metadata.is_bike` directly.
 * Returns the set of SKUs that are bikes in DB (is_bike = true).
 */
export async function resolveBikeSkuSet(skus: string[]): Promise<Set<string>> {
  const unique = Array.from(new Set(skus.filter(Boolean)));
  const result = new Set<string>();
  if (unique.length === 0) return result;

  const { data, error } = await supabase
    .from('sku_metadata')
    .select('sku, is_bike')
    .in('sku', unique);

  if (error || !data) return result;

  (data as { sku: string; is_bike: boolean | null }[]).forEach((row) => {
    if (row.is_bike === true) {
      result.add(row.sku);
    }
  });
  return result;
}
