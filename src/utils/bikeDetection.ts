import { supabase } from '../lib/supabase';

/**
 * Canonical bike detection helper.
 * `sku_metadata.is_bike` in the database is the SOLE source of truth.
 *
 * Fallback: If `is_bike` is null/uncataloged in DB, uses weight heuristic
 * (`weight_lbs >= 15` lbs, since boxed bicycles weigh 25–50+ lbs).
 */
export function isBikeSku(
  skuOrObj?:
    | string
    | {
        sku?: string;
        is_bike?: boolean | null;
        weight_lbs?: number | null;
        sku_metadata?: { is_bike?: boolean | null; weight_lbs?: number | null } | null;
      }
    | null,
  skuMetadata?: { is_bike?: boolean | null; weight_lbs?: number | null } | null
): boolean {
  if (!skuOrObj) return false;

  let isBikeFlag: boolean | null | undefined;
  let weightLbs: number | null | undefined;

  if (typeof skuOrObj === 'string') {
    isBikeFlag = skuMetadata?.is_bike;
    weightLbs = skuMetadata?.weight_lbs;
  } else if (typeof skuOrObj === 'object') {
    if ('sku_metadata' in skuOrObj && skuOrObj.sku_metadata) {
      isBikeFlag = skuOrObj.sku_metadata.is_bike;
      weightLbs = skuOrObj.sku_metadata.weight_lbs;
    } else {
      isBikeFlag = skuOrObj.is_bike;
      weightLbs = skuOrObj.weight_lbs;
    }
    if (isBikeFlag === undefined && skuMetadata?.is_bike !== undefined) {
      isBikeFlag = skuMetadata.is_bike;
    }
    if (weightLbs === undefined && skuMetadata?.weight_lbs !== undefined) {
      weightLbs = skuMetadata.weight_lbs;
    }
  }

  // 1. Explicit DB flag in sku_metadata is the SOLE canonical source of truth
  if (isBikeFlag === true) return true;
  if (isBikeFlag === false) return false;

  // 2. Emergency fallback ONLY for uncataloged items in DB (when is_bike is null/undefined):
  // Boxed bicycles weigh >= 15 lbs.
  if (typeof weightLbs === 'number' && weightLbs >= 15) return true;

  return false;
}

/**
 * Authoritative bike detection for a list of SKUs.
 * Queries `sku_metadata.is_bike` from DB.
 */
export async function resolveBikeSkuSet(skus: string[]): Promise<Set<string>> {
  const unique = Array.from(new Set(skus.filter(Boolean)));
  const result = new Set<string>();
  if (unique.length === 0) return result;

  const { data, error } = await supabase
    .from('sku_metadata')
    .select('sku, is_bike, weight_lbs')
    .in('sku', unique);

  if (error || !data) return result;

  (data as { sku: string; is_bike: boolean | null; weight_lbs: number | null }[]).forEach((row) => {
    if (isBikeSku(row.sku, row)) {
      result.add(row.sku);
    }
  });

  return result;
}
