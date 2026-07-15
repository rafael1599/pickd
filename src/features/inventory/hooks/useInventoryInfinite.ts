import { useInfiniteQuery } from '@tanstack/react-query';
import { inventoryService } from '../api/inventory.service';
import { inventoryKeys } from '../../../lib/query-keys';
import { useMemo } from 'react';

const PAGE_SIZE = 50; // Smaller chunks for smoother infinite loading

export function useInventoryInfinite(search = '') {
  const query = useInfiniteQuery({
    queryKey: inventoryKeys.list({ search, limit: PAGE_SIZE }),
    queryFn: ({ pageParam = 0 }) =>
      inventoryService.getWithFilters({
        search,
        page: pageParam as number,
        limit: PAGE_SIZE,
      }),
    initialPageParam: 0,
    getNextPageParam: (lastPage, allPages) => {
      // Calculate if we have more results based on the total count from the first page
      const totalCount = lastPage.count ?? 0;
      const loadedCount = allPages.length * PAGE_SIZE;

      return loadedCount < totalCount ? allPages.length : undefined;
    },
    // OFF-LINE & SPEED OPTIMIZATIONS
    staleTime: 1000 * 60 * 10, // 10 minutes - Aggressive cache for warehouse speed
    gcTime: 1000 * 60 * 60 * 24 * 7, // 7 days in persistence
    networkMode: 'offlineFirst', // CRITICAL: Access cache immediately even if offline
  });

  // Data Flattening / UI Helper
  const { data, fetchNextPage, hasNextPage } = query;

  const inventory = useMemo(() => {
    const flattened = data?.pages.flatMap((page) => page.data) ?? [];
    const seen = new Set<number>();
    return flattened.filter((item) => {
      if (seen.has(item.id)) return false;
      seen.add(item.id);
      return true;
    });
  }, [data]);

  const totalCount = data?.pages[0]?.count ?? 0;
  const remaining = Math.max(0, totalCount - inventory.length);

  return {
    ...query,
    inventory,
    totalCount,
    remaining,
    hasNextPage,
    loadMore: () => fetchNextPage(),
  };
}
