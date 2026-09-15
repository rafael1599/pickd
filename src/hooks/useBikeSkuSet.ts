import { useEffect, useState } from 'react';
import { resolveBikeSets } from '../utils/bikeDetection';

/** Las bicis y, dentro de ellas, las pequeñas. Un solo viaje a la base. */
export interface BikeSets {
  bikes: Set<string>;
  smallBikes: Set<string>;
}

const EMPTY: BikeSets = { bikes: new Set(), smallBikes: new Set() };

/**
 * Resolves the canonical set of bike SKUs from `sku_metadata.is_bike = true`,
 * junto con las que son de línea juvenil o de rueda chica — las que el cálculo
 * de pallets trata como partes.
 */
export function useBikeSets(skus: string[]): BikeSets {
  const key = Array.from(new Set(skus.filter(Boolean)))
    .sort()
    .join(',');
  const [sets, setSets] = useState<BikeSets>(EMPTY);

  useEffect(() => {
    if (!key) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- syncing derived state from skus
      setSets(EMPTY);
      return;
    }
    let cancelled = false;
    const list = key.split(',');
    void resolveBikeSets(list).then((next) => {
      if (!cancelled) setSets(next);
    });
    return () => {
      cancelled = true;
    };
  }, [key]);

  return sets;
}

/** Sólo las bicis, para quien no necesita distinguir las pequeñas. */
export function useBikeSkuSet(skus: string[]): Set<string> {
  return useBikeSets(skus).bikes;
}
