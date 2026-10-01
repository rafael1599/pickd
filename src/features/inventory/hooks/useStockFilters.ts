import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '../../../lib/supabase';
import { inventoryApi } from '../api/inventoryApi';
import { INVENTORY_ROOT_KEY } from './useInventoryRealtime';
import { mapItem } from './stockQueries';
import type { InventoryItemWithMetadata } from '../../../schemas/inventory.schema';
import {
  EMPTY_FILTERS,
  FACET_IDS,
  activeFilterCount,
  filtersFromParams,
  writeFiltersToParams,
  type FacetId,
  type StockFilters,
} from '../utils/stockFacets';

/** The Stock filters, read from and written to the URL. */
export function useStockFilters() {
  const [params, setParams] = useSearchParams();
  // Rebuilt only when one of our keys changes, so unrelated params don't
  // invalidate every memo downstream.
  const signature = FACET_IDS.map((id) => params.getAll(id).join('\u0001')).join('\u0002');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const filters = useMemo(() => filtersFromParams(params), [signature]);

  const setFilters = useCallback(
    (next: StockFilters) => setParams((p) => writeFiltersToParams(p, next), { replace: true }),
    [setParams]
  );

  const toggle = useCallback(
    (id: FacetId, value: string) => {
      setParams(
        (p) => {
          const current = filtersFromParams(p);
          const list = current[id];
          const nextList = list.includes(value)
            ? list.filter((v) => v !== value)
            : [...list, value];
          return writeFiltersToParams(p, { ...current, [id]: nextList });
        },
        { replace: true }
      );
    },
    [setParams]
  );

  const clearFacet = useCallback(
    (id: FacetId) =>
      setParams((p) => writeFiltersToParams(p, { ...filtersFromParams(p), [id]: [] }), {
        replace: true,
      }),
    [setParams]
  );

  const clearAll = useCallback(() => setFilters(EMPTY_FILTERS), [setFilters]);

  return {
    filters,
    activeCount: activeFilterCount(filters),
    toggle,
    clearFacet,
    clearAll,
    setFilters,
  };
}

/** PostgREST caps a response at 1000 rows; every read here pages past it. */
const PAGE = 1000;

/**
 * Every bike row in LUDLOW, not the 50-row first page: a count beside a
 * filter option is a promise about the whole building. ~700 active rows.
 *
 * Same RPC as the list, so a card looks identical filtered or not, plus the
 * colour, which that RPC doesn't return. The key sits under
 * INVENTORY_ROOT_KEY so realtime and the optimistic mutations patch it like
 * the list they already patch.
 */
export const bikeCatalogKey = (showInactive: boolean) => [
  ...INVENTORY_ROOT_KEY,
  'bike-catalog',
  showInactive,
];

async function fetchBikeCatalog(showInactive: boolean): Promise<InventoryItemWithMetadata[]> {
  const rows: InventoryItemWithMetadata[] = [];
  for (let offset = 0; ; offset += PAGE) {
    const { data, count } = await inventoryApi.fetchInventoryWithMetadata({
      includeInactive: showInactive,
      showParts: false,
      warehouse: 'LUDLOW',
      offset,
      limit: PAGE,
    });
    rows.push(...(data as InventoryItemWithMetadata[]));
    if (data.length < PAGE || rows.length >= (count ?? 0)) break;
  }

  const colors = new Map<string, string | null>();
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from('sku_metadata')
      .select('sku, color')
      .eq('is_bike', true)
      .order('sku')
      .range(from, from + PAGE - 1);
    if (error) throw error;
    for (const r of data ?? []) colors.set(r.sku, r.color);
    if ((data ?? []).length < PAGE) break;
  }

  return rows.map((item) =>
    mapItem({
      ...item,
      sku_metadata: item.sku_metadata
        ? { ...item.sku_metadata, color: colors.get(item.sku) ?? null }
        : item.sku_metadata,
    })
  );
}

export function useBikeCatalog(showInactive: boolean, enabled: boolean) {
  return useQuery({
    queryKey: bikeCatalogKey(showInactive),
    queryFn: () => fetchBikeCatalog(showInactive),
    enabled,
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
  });
}
