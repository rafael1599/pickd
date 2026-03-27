import { useQuery } from '@tanstack/react-query';
import { useCallback, useMemo, useState } from 'react';

import { inventoryApi } from '../api/inventoryApi';
import { INVENTORY_ROOT_KEY, PARTS_BINS_KEY } from './useInventoryRealtime';
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

// Stable empty array to prevent re-render loops when query data hasn't loaded yet.
// Using `data ?? []` creates a new [] on every render, destabilizing downstream useMemos.
const EMPTY_INVENTORY: InventoryItemWithMetadata[] = [];

// Stable no-op stubs — module-level constants, same reference across all renders and instances.
const noop = () => {};
const noopAsync = async () => ({ successCount: 0, failCount: 0 });
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const noopUpdater = (_updates: unknown) => {};
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const noopFilters = (_filters?: unknown) => {};

/**
 * PUENTE DE TRANSICIÓN:
 * Este hook expone LA MISA FIRMA EXACTA que el viejo InventoryContext.
 * Sin embargo, por dentro NO usa un Contexto central (matando los rerendeos).
 * Por dentro usa useQuery (que deduce cache global) y useInventoryMutations.
 */
export const useInventory = () => {
  const { isAdmin, user, profile } = useAuth();
  const [showInactive, setShowInactive] = useState(false);
  const [showPartsBins, setShowPartsBins] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const { fetchLogs, undoAction } = useInventoryLogs();
  const { locations } = useLocationManagement();
  // Motores de Mutación (Optimizados y Radicals)
  const {
    updateQuantity: mutUpdateQuantity,
    addItem: mutAddItem,
    updateItem: mutUpdateItem,
    moveItem: mutMoveItem,
    deleteItem: mutDeleteItem,
    processPickingList: mutProcessPickingList,
  } = useInventoryMutations();

  // Carga Global Agrupada (Con StaleTime infinito, para que solo Websocket actualice)
  // Bikes query: ROW locations + PALLETIZED (always loaded)
  const {
    data: rawData,
    isLoading,
    error,
  } = useQuery<InventoryItemWithMetadata[]>({
    queryKey: INVENTORY_ROOT_KEY,
    queryFn: async () => {
      const rawData = await inventoryApi.fetchInventoryWithMetadata(true, false);
      return rawData.map((item: InventoryItemWithMetadata) => ({
        ...item,
        location: (item.location || '').trim().toUpperCase(),
        warehouse: item.warehouse || 'LUDLOW',
      }));
    },
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  });

  // Parts bins query: E/D rack locations (only loaded when showPartsBins is true)
  const { data: partsBinsData, isLoading: partsBinsLoading } = useQuery<
    InventoryItemWithMetadata[]
  >({
    queryKey: PARTS_BINS_KEY,
    queryFn: async () => {
      const rawData = await inventoryApi.fetchInventoryWithMetadata(true, true);
      return rawData.map((item: InventoryItemWithMetadata) => ({
        ...item,
        location: (item.location || '').trim().toUpperCase(),
        warehouse: item.warehouse || 'LUDLOW',
      }));
    },
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    enabled: showPartsBins || searchQuery.length > 0,
  });

  const needsPartsBins = showPartsBins || searchQuery.length > 0;
  const globalData = useMemo(() => {
    const bikes = rawData ?? EMPTY_INVENTORY;
    const parts = partsBinsData ?? EMPTY_INVENTORY;
    return needsPartsBins ? [...bikes, ...parts] : bikes;
  }, [rawData, partsBinsData, needsPartsBins]);

  // Filtros Locales Ultrarrápidos: El useQuery trae Ludlow y ATS temporalmente.
  // Separamos LUDLOW
  const inventoryData = useMemo(() => {
    let filtered = globalData;
    if (!showInactive) {
      filtered = filtered.filter((item) => item.is_active || (item.quantity && item.quantity > 0));
    }
    return filtered.filter((item) => item.warehouse === 'LUDLOW');
  }, [globalData, showInactive]);

  // Separamos ATS (Si existiera algo residual)
  const atsData = useMemo(() => {
    let filtered = globalData;
    if (!showInactive)
      filtered = filtered.filter((item) => item.is_active || (item.quantity && item.quantity > 0));
    return filtered.filter((item) => item.warehouse === 'ATS');
  }, [globalData, showInactive]);

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
  }, []); // Simplificado

  // Wrappers estables — mutation handles de React Query son estables por diseño
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
      internalNote?: string | null
    ) => {
      await mutMoveItem.mutateAsync({
        sourceItem,
        targetWarehouse,
        targetLocation,
        qty,
        internalNote,
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

    // Utils / Stubs (Para no romper componentes viejos)
    processPickingList,
    exportData: noop,
    syncInventoryLocations: noopAsync,
    updateInventory: noop,
    updateLudlowInventory: noopUpdater,
    updateAtsInventory: noopUpdater,
    syncFilters: noopFilters,
    showInactive,
    setShowInactive,
    showPartsBins,
    setShowPartsBins,
    setSearchQuery,
    partsBinsLoading,
    isAdmin,
    user,
    profile,
  };
};
