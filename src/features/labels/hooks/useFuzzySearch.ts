import { useMemo, useCallback } from 'react';
import uFuzzy from '@leeoniya/ufuzzy';
import { useLabelItems, type LabelInventoryItem } from './useLabelItems';

export function useFuzzySearch(excludeSkus: Set<string>) {
  const { data: items } = useLabelItems();

  const haystack = useMemo(
    () => (items ?? []).map((i) => `${i.sku} ${i.item_name ?? ''}`),
    [items]
  );

  const uf = useMemo(() => new uFuzzy({ intraMode: 1 }), []);

  const search = useCallback(
    (q: string): LabelInventoryItem[] => {
      if (!items || q.length < 2) return [];

      const result = uf.search(haystack, q);
      const [idxs, , order] = result;

      if (!idxs || idxs.length === 0) return [];

      // Map indices back to items, respecting order if available
      const orderedIdxs = order ? order.map((o) => idxs[o]) : idxs;

      const matched = orderedIdxs
        .map((idx) => items[idx])
        .filter((item) => item && !excludeSkus.has(item.sku));

      // Re-rank: exact SKU match first, then by quantity descending
      const qUpper = q.toUpperCase();
      matched.sort((a, b) => {
        const aExact = a.sku.toUpperCase() === qUpper ? 1 : 0;
        const bExact = b.sku.toUpperCase() === qUpper ? 1 : 0;
        if (aExact !== bExact) return bExact - aExact;

        const aStartsWith = a.sku.toUpperCase().startsWith(qUpper) ? 1 : 0;
        const bStartsWith = b.sku.toUpperCase().startsWith(qUpper) ? 1 : 0;
        if (aStartsWith !== bStartsWith) return bStartsWith - aStartsWith;

        return b.quantity - a.quantity;
      });

      return matched.slice(0, 8);
    },
    [items, haystack, uf, excludeSkus]
  );

  return {
    search,
    isReady: !!items && items.length > 0,
  };
}
