import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useInventory } from '../useInventoryData';
import { bikesListKey } from '../stockQueries';
import { PARTS_BINS_KEY } from '../useInventoryRealtime';
import { inventoryApi } from '../../api/inventoryApi';
import type { InventoryItemWithMetadata } from '../../../../schemas/inventory.schema';

vi.mock('../useInventoryLogs', () => ({
  useInventoryLogs: () => ({ fetchLogs: vi.fn(), undoAction: vi.fn() }),
}));

vi.mock('../useLocationManagement', () => ({
  useLocationManagement: () => ({ locations: [] }),
}));

vi.mock('../useInventoryMutations', () => ({
  useInventoryMutations: () => ({
    updateQuantity: vi.fn(),
    addItem: vi.fn(),
    updateItem: vi.fn(),
    moveItem: vi.fn(),
    deleteItem: vi.fn(),
    processPickingList: vi.fn(),
    recompletePickingList: vi.fn(),
  }),
}));

vi.mock('../../../../context/AuthContext', () => ({
  useAuth: () => ({ isAdmin: false, user: null, profile: null }),
}));

vi.mock('../../api/inventoryApi', () => ({
  inventoryApi: {
    fetchInventoryWithMetadata: vi.fn(),
  },
}));

function createFakeItem(id: number, sku: string): InventoryItemWithMetadata {
  return {
    id,
    sku,
    quantity: 1,
    location: 'ROW 1',
    warehouse: 'LUDLOW',
    is_active: true,
    distribution: [],
    created_at: new Date('2026-10-08T00:00:00Z'),
    updated_at: new Date('2026-10-08T00:00:00Z'),
    sku_metadata: {
      sku,
      is_bike: true,
    },
  } as unknown as InventoryItemWithMetadata;
}

describe('bug-050: loadMoreInventory uses the observed queryKey and offset = cache length', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(inventoryApi.fetchInventoryWithMetadata).mockImplementation(async () => ({
      data: [],
      count: 0,
    }));
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false, gcTime: Infinity },
      },
    });
  });

  const wrapper = ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: queryClient }, children);

  it('con 50 en caché bajo bikesListKey(false), load more pide offset: 50 y deja 100 en esa misma clave', async () => {
    // Seed initial 50 bikes in the exact key that Stock screen observes
    const initialBikes = Array.from({ length: 50 }, (_, i) =>
      createFakeItem(i + 1, `01-000${i + 1}`)
    );
    queryClient.setQueryData(bikesListKey(false), initialBikes);

    // Mock API returning next 50 bikes
    const next50Bikes = Array.from({ length: 50 }, (_, i) =>
      createFakeItem(i + 51, `01-00${i + 51}`)
    );
    vi.mocked(inventoryApi.fetchInventoryWithMetadata).mockResolvedValueOnce({
      data: next50Bikes,
      count: 200,
    });

    const { result } = renderHook(() => useInventory(), { wrapper });

    await act(async () => {
      await result.current.loadMoreInventory(false);
    });

    // Check that fetchInventoryWithMetadata was called with offset = 50, limit = 50
    expect(inventoryApi.fetchInventoryWithMetadata).toHaveBeenCalledWith({
      includeInactive: false,
      showParts: false,
      warehouse: 'LUDLOW',
      offset: 50,
      limit: 50,
    });

    // Verify cache has 100 items under bikesListKey(false)
    const cachedBikes = queryClient.getQueryData<InventoryItemWithMetadata[]>(bikesListKey(false));
    expect(cachedBikes).toBeDefined();
    expect(cachedBikes).toHaveLength(100);
    expect(cachedBikes?.[0].id).toBe(1);
    expect(cachedBikes?.[99].id).toBe(100);
  });

  it('para partes, usa [...PARTS_BINS_KEY, showInactive] con offset correcto y guarda en esa misma clave', async () => {
    const partsKey = [...PARTS_BINS_KEY, false];
    const initialParts = Array.from({ length: 30 }, (_, i) =>
      createFakeItem(i + 1, `99-000${i + 1}`)
    );
    queryClient.setQueryData(partsKey, initialParts);

    const next30Parts = Array.from({ length: 30 }, (_, i) =>
      createFakeItem(i + 31, `99-00${i + 31}`)
    );
    vi.mocked(inventoryApi.fetchInventoryWithMetadata).mockImplementation(async (params) => {
      if (params?.showParts && params?.offset === 30) {
        return { data: next30Parts, count: 100 };
      }
      return { data: [], count: 0 };
    });

    const { result } = renderHook(() => useInventory(), { wrapper });

    await act(async () => {
      await result.current.loadMoreInventory(true);
    });

    expect(inventoryApi.fetchInventoryWithMetadata).toHaveBeenCalledWith({
      includeInactive: false,
      showParts: true,
      warehouse: 'LUDLOW',
      offset: 30,
      limit: 50,
    });

    const cachedParts = queryClient.getQueryData<InventoryItemWithMetadata[]>(partsKey);
    expect(cachedParts).toBeDefined();
    expect(cachedParts).toHaveLength(60);
  });
});
