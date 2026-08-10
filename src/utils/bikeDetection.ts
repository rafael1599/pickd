import { supabase } from '../lib/supabase';

/**
 * Regex pattern for Bike SKUs:
 * - Standard bike SKU pattern: 2 digits, hyphen, 4 digits, 2+ letters (e.g. 03-4664YL)
 * - Known bike SKU prefixes: 01-, 03-, 05-, 06-, 07-
 */
export const BIKE_SKU_REGEX = /^(\d{2}-\d{4}[A-Za-z]{2,}|(01|03|05|06|07)-)/i;

/**
 * Checks if a SKU string matches standard bicycle SKU patterns.
 */
export function isBikeSkuPattern(sku?: string | null): boolean {
  if (!sku) return false;
  return BIKE_SKU_REGEX.test(sku.trim());
}

/**
 * Canonical bike detection helper.
 * Determines if an item/SKU is a bicycle based on:
 * 1. DB explicit `is_bike === true` flag
 * 2. SKU pattern match (e.g. 03-4664YL, 01-xxxx, 05-xxxx)
 * 3. Weight heuristic (`weight_lbs >= 15` lbs, since boxed bikes weigh 25–50+ lbs)
 * 4. Fallback to `false` if explicitly marked `is_bike === false` AND not matching bike patterns/weight
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

  let skuStr: string | undefined;
  let isBikeFlag: boolean | null | undefined;
  let weightLbs: number | null | undefined;

  if (typeof skuOrObj === 'string') {
    skuStr = skuOrObj;
    isBikeFlag = skuMetadata?.is_bike;
    weightLbs = skuMetadata?.weight_lbs;
  } else if (typeof skuOrObj === 'object') {
    skuStr = skuOrObj.sku;
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

  // 1. Explicit DB flag in sku_metadata is the CANONICAL source of truth
  if (isBikeFlag === true) return true;
  if (isBikeFlag === false) return false;

  // 2. Fallbacks for uncataloged SKUs (when is_bike is null/undefined in DB):
  // SKU pattern match (e.g. 03-4664YL)
  if (skuStr && isBikeSkuPattern(skuStr)) return true;

  // Weight heuristic (boxed bikes weigh 15-50+ lbs, parts are small/light)
  if (typeof weightLbs === 'number' && weightLbs >= 15) return true;

  return false;
}

/**
 * Authoritative bike detection for a list of SKUs.
 * Returns the set of SKUs that are bikes based on DB flag, pattern matching, or weight.
 */
export async function resolveBikeSkuSet(skus: string[]): Promise<Set<string>> {
  const unique = Array.from(new Set(skus.filter(Boolean)));
  const result = new Set<string>();
  if (unique.length === 0) return result;

  const { data, error } = await supabase
    .from('sku_metadata')
    .select('sku, is_bike, weight_lbs')
    .in('sku', unique);

  if (error || !data) {
    unique.forEach((sku) => {
      if (isBikeSkuPattern(sku)) result.add(sku);
    });
    return result;
  }

  const metaMap = new Map<string, { is_bike?: boolean | null; weight_lbs?: number | null }>();
  (
    data as unknown as { sku: string; is_bike: boolean | null; weight_lbs: number | null }[]
  ).forEach((row) => {
    metaMap.set(row.sku, row);
  });

  unique.forEach((sku) => {
    const meta = metaMap.get(sku);
    if (isBikeSku(sku, meta)) {
      result.add(sku);
    }
  });

  return result;
}
