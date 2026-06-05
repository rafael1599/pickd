import { useEffect, useState } from 'react';
import { inferBikeSkusByPrefix, resolveBikeSkuSet } from '../utils/bikeDetection';

/**
 * Resolves the set of bike SKUs for a list of SKUs: seeds synchronously with the
 * "03-" prefix heuristic, then replaces it with the authoritative
 * `sku_metadata.is_bike` result. Lets components compute bike-aware pallets
 * (bikes paginate, parts consolidate into one pallet).
 */
export function useBikeSkuSet(skus: string[]): Set<string> {
  const key = Array.from(new Set(skus.filter(Boolean)))
    .sort()
    .join(',');
  const [bikeSkuSet, setBikeSkuSet] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!key) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- syncing derived state from skus
      setBikeSkuSet(new Set());
      return;
    }
    let cancelled = false;
    const list = key.split(',');
    setBikeSkuSet(inferBikeSkusByPrefix(list)); // immediate prefix seed before async fetch
    void resolveBikeSkuSet(list).then((set) => {
      if (!cancelled) setBikeSkuSet(set);
    });
    return () => {
      cancelled = true;
    };
  }, [key]);

  return bikeSkuSet;
}
