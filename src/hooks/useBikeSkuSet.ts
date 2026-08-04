import { useEffect, useState } from 'react';
import { resolveBikeSkuSet } from '../utils/bikeDetection';

/**
 * Resolves the canonical set of bike SKUs from `sku_metadata.is_bike = true`.
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
    void resolveBikeSkuSet(list).then((set) => {
      if (!cancelled) setBikeSkuSet(set);
    });
    return () => {
      cancelled = true;
    };
  }, [key]);

  return bikeSkuSet;
}
