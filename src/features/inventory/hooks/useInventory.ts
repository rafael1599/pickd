import { useQuery } from '@tanstack/react-query';
import { inventoryService } from '../api/inventory.service';
import { inventoryKeys } from '../../../lib/query-keys';

/**
 * Hook to fetch and manage the inventory list with TanStack Query.
 * Includes automatic caching and background synchronization.
 */
export function useInventoryList(filters: { search?: string; page?: number; limit?: number } = {}) {
  const { search = '', page = 0, limit = 100 } = filters;

  return useQuery({
    queryKey: inventoryKeys.list({ search, page, limit }),
    queryFn: () => inventoryService.getWithFilters({ search, page, limit }),
    // Optimization for inventory: keep data "stale" but don't refetch too aggressively
    // if the user is just navigating, unless explicitly requested.
    staleTime: 1000 * 60 * 2, // 2 minutes
  });
}
