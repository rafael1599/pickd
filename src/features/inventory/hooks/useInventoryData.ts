import { useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { useCallback, useMemo, useRef, useState } from 'react';

import { supabase } from '../../../lib/supabase';
import { inventoryApi } from '../api/inventoryApi';
import {
  INVENTORY_ROOT_KEY,
  PARTS_BINS_KEY,
  SD_BINS_KEY,
  FDX_BINS_KEY,
} from './useInventoryRealtime';
import { useInventoryMutations } from './useInventoryMutations';
import { useInventoryLogs } from './useInventoryLogs';
import { useLocationManagement } from './useLocationManagement';
import { useAuth } from '../../../context/AuthContext';
import {
  type InventoryItemWithMetadata,
  type InventoryItemInput,
} from '../../../schemas/inventory.schema';
import { type SKUMetadataInput } from '../../../schemas/skuMetadata.schema';
import { InventoryProvider } from './InventoryProvider';

export { InventoryProvider };

const EMPTY_INVENTORY: InventoryItemWithMetadata[] = [];

const noop = () => {};
const noopAsync = async () => ({ successCount: 0, failCount: 0 });
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const noopUpdater = (_updates: unknown) => {};
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const noopFilters = (_filters?: unknown) => {};

/** Page sizes for server-side pagination */
const INITIAL_PAGE_SIZE = 50;
const LOAD_MORE_SIZE = 50;
const SEARCH_LIMIT = 30;

function mapItem(item: InventoryItemWithMetadata): InventoryItemWithMetadata {
  return {
    ...item,
    location: (item.location || '').trim().toUpperCase(),
    warehouse: item.warehouse || 'LUDLOW',
  };
}

export const useInventory = () => {
  const { isAdmin, user, profile } = useAuth();
  const queryClient = useQueryClient();
  const [showInactive, setShowInactive] = useState(false);
  const [showParts, setShowParts] = useState(false);
  const [showScratchDent, setShowScratchDent] = useState(false);
  const [showFedexReturns, setShowFedexReturns] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const { fetchLogs, undoAction } = useInventoryLogs();
  const { locations } = useLocationManagement();

  // Pagination state
  const [bikesTotal, setBikesTotal] = useState<number | null>(null);
  const [partsTotal, setPartsTotal] = useState<number | null>(null);
  const [scratchDentTotal, setScratchDentTotal] = useState<number | null>(null);
  const [fedexReturnsTotal, setFedexReturnsTotal] = useState<number | null>(null);
  // searchTotal is now derived from searchData query result (no separate state)
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const isLoadingMoreRef = useRef(false);

  const {
    updateQuantity: mutUpdateQuantity,
    addItem: mutAddItem,
    updateItem: mutUpdateItem,
    moveItem: mutMoveItem,
    deleteItem: mutDeleteItem,
    processPickingList: mutProcessPickingList,
    recompletePickingList: mutRecompletePickingList,
  } = useInventoryMutations();

  // ── Global stats (single RPC call — returns 2 numbers) ──
  const { data: globalStats } = useQuery({
    queryKey: ['inventory', 'stats', showParts],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_inventory_stats', {
        p_include_parts: showParts,
      });
      if (error) throw error;
      const row = data?.[0];
      return {
        totalSkus: Number(row?.total_skus ?? 0),
        totalQuantity: Number(row?.total_units ?? 0),
        totalCapacity: Number(row?.total_capacity ?? 0),
      };
    },
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });

  // ── Bikes query (is_bike = true) — paginated initial load ─────────
  const {
    data: rawData,
    isLoading,
    error,
  } = useQuery<InventoryItemWithMetadata[]>({
    queryKey: [...INVENTORY_ROOT_KEY, showInactive],
    queryFn: async () => {
      const { data, count } = await inventoryApi.fetchInventoryWithMetadata({
        includeInactive: showInactive,
        showParts: false,
        warehouse: 'LUDLOW',
        limit: INITIAL_PAGE_SIZE,
      });
      setBikesTotal(count);
      const withQty = data.filter((i) => (i.quantity ?? 0) > 0).length;
      console.log(
        `📦 [StockView] User sees ${data.length} items on reload, items with qty > 0 = ${withQty}, server total = ${count}`
      );
      return data.map(mapItem);
    },
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  });

  // ── Parts query (all items) — only when toggled or searching ──────
  const { data: partsData, isLoading: partsLoading } = useQuery<InventoryItemWithMetadata[]>({
    queryKey: [...PARTS_BINS_KEY, showInactive],
    queryFn: async () => {
      const { data, count } = await inventoryApi.fetchInventoryWithMetadata({
        includeInactive: showInactive,
        showParts: true,
        warehouse: 'LUDLOW',
        limit: INITIAL_PAGE_SIZE,
      });
      setPartsTotal(count);
      return data.map(mapItem);
    },
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    enabled: showParts || searchQuery.length > 0,
  });

  // ── S/D query (only items where sku_metadata.is_scratch_dent=true) ──
  const { data: scratchDentData, isLoading: scratchDentLoading } = useQuery<
    InventoryItemWithMetadata[]
  >({
    queryKey: [...SD_BINS_KEY, showInactive],
    queryFn: async () => {
      const { data, count } = await inventoryApi.fetchInventoryWithMetadata({
        includeInactive: showInactive,
        onlyScratchDent: true,
        warehouse: 'LUDLOW',
        limit: INITIAL_PAGE_SIZE,
      });
      setScratchDentTotal(count);
      return data.map(mapItem);
    },
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    enabled: showScratchDent,
  });

  // ── FedEx Returns query — only when toggled ────────────────────────
  const { data: fedexReturnsData, isLoading: fedexReturnsLoading } = useQuery<
    InventoryItemWithMetadata[]
  >({
    queryKey: [...FDX_BINS_KEY, showInactive],
    queryFn: async () => {
      const { data, count } = await inventoryApi.fetchInventoryWithMetadata({
        includeInactive: showInactive,
        onlyFedexReturns: true,
        warehouse: 'LUDLOW',
        limit: INITIAL_PAGE_SIZE,
      });
      setFedexReturnsTotal(count);
      return data.map(mapItem);
    },
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    enabled: showFedexReturns,
  });

  // ── Server-side search query (separate from main cache) ───────────
  const { data: searchData, isLoading: isSearching } = useQuery<{
    items: InventoryItemWithMetadata[];
    total: number;
  }>({
    queryKey: ['inventory', 'search', searchQuery],
    queryFn: async () => {
      const [bikesRes, partsRes] = await Promise.all([
        inventoryApi.fetchInventoryWithMetadata({
          includeInactive: true,
          showParts: false,
          search: searchQuery,
          warehouse: 'LUDLOW',
          limit: SEARCH_LIMIT,
        }),
        inventoryApi.fetchInventoryWithMetadata({
          includeInactive: true,
          showParts: true,
          search: searchQuery,
          warehouse: 'LUDLOW',
          limit: SEARCH_LIMIT,
        }),
      ]);
      const total = (bikesRes.count ?? 0) + (partsRes.count ?? 0);
      const combined = [...bikesRes.data, ...partsRes.data];
      const seen = new Set<number>();
      const items = combined
        .filter((item) => {
          const id = item.id as number;
          if (seen.has(id)) return false;
          seen.add(id);
          return true;
        })
        .map(mapItem);
      return { items, total };
    },
    staleTime: 1000 * 60 * 2,
    enabled: searchQuery.length > 0,
    placeholderData: keepPreviousData,
  });

  const searchResults = searchData?.items;
  const searchTotal = searchData?.total ?? null;

  // ── Load more items (appends to cache) ────────────────────────────
  const loadMoreInventory = useCallback(
    async (loadParts = false) => {
      if (isLoadingMoreRef.current) return;
      isLoadingMoreRef.current = true;
      setIsLoadingMore(true);
      const cacheKey = loadParts ? PARTS_BINS_KEY : INVENTORY_ROOT_KEY;
      const currentLen = (queryClient.getQueryData<InventoryItemWithMetadata[]>(cacheKey) || [])
        .length;
      console.log(
        `📦 [LoadMore] Fetching ${loadParts ? 'parts' : 'bikes'} offset=${currentLen} limit=${LOAD_MORE_SIZE}`
      );
      try {
        const cacheKey = loadParts ? PARTS_BINS_KEY : INVENTORY_ROOT_KEY;
        const currentData = queryClient.getQueryData<InventoryItemWithMetadata[]>(cacheKey) || [];

        const { data: newItems, count } = await inventoryApi.fetchInventoryWithMetadata({
          includeInactive: showInactive,
          showParts: loadParts,
          warehouse: 'LUDLOW',
          offset: currentData.length,
          limit: LOAD_MORE_SIZE,
        });

        if (loadParts) setPartsTotal(count);
        else setBikesTotal(count);

        const mapped = newItems.map(mapItem);

        queryClient.setQueryData(cacheKey, (old: InventoryItemWithMetadata[] | undefined) => {
          if (!old) return mapped;
          const existingIds = new Set(old.map((i) => i.id));
          const unique = mapped.filter((i) => !existingIds.has(i.id));
          const result = [...old, ...unique];
          console.log(
            `📦 [LoadMore] Cache updated: ${old.length} → ${result.length} items (fetched ${newItems.length}, unique ${unique.length}, total server=${count})`
          );
          return result;
        });
      } finally {
        isLoadingMoreRef.current = false;
        setIsLoadingMore(false);
      }
    },
    [queryClient, showInactive]
  );

  const hasMoreBikes = bikesTotal !== null && (rawData?.length ?? 0) < bikesTotal;
  const hasMoreParts = partsTotal !== null && (partsData?.length ?? 0) < partsTotal;
  const hasMoreSearch = searchTotal !== null && (searchResults?.length ?? 0) < searchTotal;
  const hasMoreItems = searchQuery ? hasMoreSearch : hasMoreBikes || (showParts && hasMoreParts);

  const loadMoreSearch = useCallback(async () => {
    if (isLoadingMoreRef.current || !searchQuery) return;
    isLoadingMoreRef.current = true;
    setIsLoadingMore(true);
    try {
      const currentItems = searchData?.items ?? [];
      const nextOffset = currentItems.length;

      const [bikesRes, partsRes] = await Promise.all([
        inventoryApi.fetchInventoryWithMetadata({
          includeInactive: true,
          showParts: false,
          search: searchQuery,
          warehouse: 'LUDLOW',
          offset: nextOffset,
          limit: LOAD_MORE_SIZE,
        }),
        inventoryApi.fetchInventoryWithMetadata({
          includeInactive: true,
          showParts: true,
          search: searchQuery,
          warehouse: 'LUDLOW',
          offset: nextOffset,
          limit: LOAD_MORE_SIZE,
        }),
      ]);

      const total = (bikesRes.count ?? 0) + (partsRes.count ?? 0);
      const newItems = [...bikesRes.data, ...partsRes.data].map(mapItem);

      queryClient.setQueryData(
        ['inventory', 'search', searchQuery],
        (old: { items: InventoryItemWithMetadata[]; total: number } | undefined) => {
          if (!old) return { items: newItems, total };
          const existingIds = new Set(old.items.map((i) => i.id));
          const unique = newItems.filter((i) => !existingIds.has(i.id));
          return { items: [...old.items, ...unique], total };
        }
      );
    } finally {
      isLoadingMoreRef.current = false;
      setIsLoadingMore(false);
    }
  }, [searchQuery, searchData, queryClient]);

  const loadMore = useCallback(async () => {
    if (searchQuery) {
      await loadMoreSearch();
    } else if (hasMoreBikes) {
      await loadMoreInventory(false);
    } else if (showParts && hasMoreParts) {
      await loadMoreInventory(true);
    }
  }, [searchQuery, loadMoreSearch, hasMoreBikes, hasMoreParts, showParts, loadMoreInventory]);

  // ── Merge data: use search results when searching, else paginated data ─
  const isActiveSearch = searchQuery.length > 0;

  const globalData = useMemo(() => {
    if (isActiveSearch) {
      return searchResults ?? EMPTY_INVENTORY;
    }
    if (showFedexReturns) return fedexReturnsData ?? EMPTY_INVENTORY;
    if (showScratchDent) return scratchDentData ?? EMPTY_INVENTORY;
    const bikes = rawData ?? EMPTY_INVENTORY;
    const parts = partsData ?? EMPTY_INVENTORY;
    if (showParts) return parts;
    return bikes;
  }, [
    isActiveSearch,
    searchResults,
    rawData,
    partsData,
    scratchDentData,
    fedexReturnsData,
    showParts,
    showScratchDent,
    showFedexReturns,
  ]);

  // All filtering (warehouse, inactive) now handled server-side
  const inventoryData = globalData;

  // ATS data: no longer in main query (filtered to LUDLOW server-side)
  const atsData = EMPTY_INVENTORY;

  const locationCapacities = useMemo(() => {
    const caps: Record<string, { current: number; max: number }> = {};
    globalData.forEach((item) => {
      if (!item.warehouse || !item.location) return;
      const key = `${item.warehouse}-${item.location.trim().toUpperCase()}`;
      if (!caps[key]) {
        const loc = locations?.find(
          (l) =>
            l.warehouse === item.warehouse &&
            l.location?.toUpperCase() === item.location?.toUpperCase()
        );
        caps[key] = { current: 0, max: loc?.max_capacity || 550 };
      }
      caps[key].current += Number(item.quantity) || 0;
    });
    return caps;
  }, [globalData, locations]);

  const reservedQuantities = useMemo(() => {
    return {} as Record<string, number>;
  }, []);

  // Wrappers
  const updateQuantity = useCallback(
    async (
      sku: string,
      delta: number,
      warehouse?: string | null,
      location?: string | null,
      isReversal?: boolean
    ) => {
      await mutUpdateQuantity.mutateAsync({
        sku,
        delta,
        warehouse: warehouse || 'LUDLOW',
        location: location || '',
        isReversal,
      });
    },
    [mutUpdateQuantity]
  );

  const updateLudlowQuantity = useCallback(
    async (sku: string, delta: number, location?: string | null) => {
      await mutUpdateQuantity.mutateAsync({
        sku,
        delta,
        warehouse: 'LUDLOW',
        location: location || '',
      });
    },
    [mutUpdateQuantity]
  );

  const updateAtsQuantity = useCallback(
    async (sku: string, delta: number, location?: string | null) => {
      await mutUpdateQuantity.mutateAsync({
        sku,
        delta,
        warehouse: 'ATS',
        location: location || '',
      });
    },
    [mutUpdateQuantity]
  );

  const addItem = useCallback(
    async (warehouse: string, newItem: InventoryItemInput) => {
      await mutAddItem.mutateAsync({ warehouse, newItem });
    },
    [mutAddItem]
  );

  const updateItem = useCallback(
    async (originalItem: InventoryItemWithMetadata, updatedFormData: InventoryItemInput) => {
      await mutUpdateItem.mutateAsync({ originalItem, updatedFormData });
    },
    [mutUpdateItem]
  );

  const moveItem = useCallback(
    async (
      sourceItem: InventoryItemWithMetadata,
      targetWarehouse: string,
      targetLocation: string,
      qty: number,
      _isReversal?: boolean,
      internalNote?: string | null,
      targetSublocation?: string[] | null
    ) => {
      await mutMoveItem.mutateAsync({
        sourceItem,
        targetWarehouse,
        targetLocation,
        qty,
        internalNote,
        targetSublocation,
      });
    },
    [mutMoveItem]
  );

  const deleteItem = useCallback(
    async (warehouse: string, sku: string, location?: string | null) => {
      await mutDeleteItem.mutateAsync({ warehouse, sku, location });
    },
    [mutDeleteItem]
  );

  const processPickingList = useCallback(
    async (listId: string, palletsQty: number, totalUnits: number) => {
      await mutProcessPickingList.mutateAsync({ listId, palletsQty, totalUnits });
    },
    [mutProcessPickingList]
  );

  const recompletePickingList = useCallback(
    async (listId: string, palletsQty: number, totalUnits: number) => {
      await mutRecompletePickingList.mutateAsync({ listId, palletsQty, totalUnits });
    },
    [mutRecompletePickingList]
  );

  const updateSKUMetadata = useCallback(async (metadata: SKUMetadataInput) => {
    await inventoryApi.upsertMetadata(metadata);
  }, []);

  const getAvailableStock = useCallback(
    (sku: string, warehouse = 'LUDLOW') => {
      const item = globalData.find((i) => i.sku === sku && i.warehouse === warehouse);
      return item?.quantity || 0;
    },
    [globalData]
  );

  return {
    // Datos
    inventoryData,
    ludlowData: inventoryData,
    atsData,
    ludlowInventory: inventoryData,
    atsInventory: atsData,
    locationCapacities,
    reservedQuantities,
    loading: isLoading,
    error: error ? error.message : null,

    // Acciones Reales
    updateQuantity,
    updateLudlowQuantity,
    updateAtsQuantity,
    addItem,
    updateItem,
    moveItem,
    deleteItem,
    undoAction,
    updateSKUMetadata,
    fetchLogs,
    getAvailableStock,

    // Pagination
    loadMore,
    hasMoreItems,
    isLoadingMore,
    searchTotal,
    serverTotal: (bikesTotal ?? 0) + (partsTotal ?? 0),
    globalStats: globalStats ?? null,

    // Utils / Stubs
    processPickingList,
    recompletePickingList,
    syncInventoryLocations: noopAsync,
    updateInventory: noop,
    updateLudlowInventory: noopUpdater,
    updateAtsInventory: noopUpdater,
    syncFilters: noopFilters,
    showInactive,
    setShowInactive,
    showParts,
    setShowParts,
    showScratchDent,
    setShowScratchDent,
    scratchDentLoading,
    scratchDentTotal,
    showFedexReturns,
    setShowFedexReturns,
    fedexReturnsLoading,
    fedexReturnsTotal,
    setSearchQuery,
    partsLoading,
    isSearching,
    isAdmin,
    user,
    profile,
  };
};
