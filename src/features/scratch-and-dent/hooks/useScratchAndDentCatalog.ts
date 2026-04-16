import { useQuery } from '@tanstack/react-query';
import { scratchAndDentApi, type CatalogFilters } from '../api/scratchAndDentApi';

export const SD_CATALOG_KEY = ['sd-catalog'] as const;

/**
 * Catalog query for the dedicated S/D screen (/sd-catalog).
 * Realtime invalidation is handled by useInventoryRealtime which already
 * listens to bike_units changes and invalidates ['sd-catalog'].
 */
export function useScratchAndDentCatalog(filters: CatalogFilters = {}) {
  return useQuery({
    queryKey: [...SD_CATALOG_KEY, filters],
    queryFn: () => scratchAndDentApi.fetchCatalog(filters),
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });
}

export function useScratchAndDentFilterOptions() {
  return useQuery({
    queryKey: ['sd-catalog', 'filter-options'],
    queryFn: () => scratchAndDentApi.fetchFilterOptions(),
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
  });
}

export function useScratchAndDentBySku(sku: string | null | undefined) {
  return useQuery({
    queryKey: ['sd-catalog', 'by-sku', sku],
    queryFn: () => scratchAndDentApi.fetchUnitBySku(sku!),
    enabled: !!sku,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });
}
