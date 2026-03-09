import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';

import { inventoryApi } from '../api/inventoryApi';
import { INVENTORY_ROOT_KEY } from './useInventoryRealtime';
import { useInventoryMutations } from './useInventoryMutations';
import { useInventoryLogs } from './useInventoryLogs';
import { useAuth } from '../../../context/AuthContext';
import { type InventoryItemWithMetadata } from '../../../schemas/inventory.schema';
import { type SKUMetadataInput } from '../../../schemas/skuMetadata.schema';
import { InventoryProvider } from './InventoryProvider';

export { InventoryProvider };

/**
 * PUENTE DE TRANSICIÓN:
 * Este hook expone LA MISA FIRMA EXACTA que el viejo InventoryContext.
 * Sin embargo, por dentro NO usa un Contexto central (matando los rerendeos).
 * Por dentro usa useQuery (que deduce cache global) y useInventoryMutations.
 */
export const useInventory = () => {
    const { isAdmin, user, profile } = useAuth();
    const [showInactive, setShowInactive] = useState(false);
    const { fetchLogs, undoAction } = useInventoryLogs();
    // Motores de Mutación (Optimizados y Radicals)
    const {
        updateQuantity: mutUpdateQuantity,
        addItem: mutAddItem,
        updateItem: mutUpdateItem,
        moveItem: mutMoveItem,
        deleteItem: mutDeleteItem,
        processPickingList: mutProcessPickingList
    } = useInventoryMutations();

    // Carga Global Agrupada (Con StaleTime infinito, para que solo Websocket actualice)
    const { data: globalData = [], isLoading, error } = useQuery<InventoryItemWithMetadata[]>({
        queryKey: INVENTORY_ROOT_KEY,
        queryFn: async () => {
            const rawData = await inventoryApi.fetchInventoryWithMetadata(true); // Trae Inactivos y limpiamos local
            // Ensure no invalid refs or spaces
            return rawData.map((item: any) => ({
                ...item,
                location: (item.location || '').trim().toUpperCase(),
                warehouse: item.warehouse || 'LUDLOW'
            })) as InventoryItemWithMetadata[];
        },
        staleTime: Infinity, // Dependemos estricta y únicamente de Websockets (useInventoryRealtime)
        refetchOnWindowFocus: false,
    });

    // Filtros Locales Ultrarrápidos: El useQuery trae Ludlow y ATS temporalmente.
    // Separamos LUDLOW
    const inventoryData = useMemo(() => {
        let filtered = globalData;
        if (!showInactive) {
            filtered = filtered.filter(item => item.is_active || (item.quantity && item.quantity > 0));
        }
        return filtered.filter(item => item.warehouse === 'LUDLOW');
    }, [globalData, showInactive]);

    // Separamos ATS (Si existiera algo residual)
    const atsData = useMemo(() => {
        let filtered = globalData;
        if (!showInactive) filtered = filtered.filter(item => item.is_active || (item.quantity && item.quantity > 0));
        return filtered.filter(item => item.warehouse === 'ATS');
    }, [globalData, showInactive]);

    const locationCapacities = useMemo(() => { return {} as Record<string, any>; }, []); // Simplificado para acelerar refactor
    const reservedQuantities = useMemo(() => { return {} as Record<string, any>; }, []); // Simplificado

    // Wrappers para la interfaz antigua
    const updateQuantity = async (
        sku: string, delta: number, warehouse?: string | null, location?: string | null, isReversal?: boolean
    ) => {
        await mutUpdateQuantity.mutateAsync({ sku, delta, warehouse: warehouse || 'LUDLOW', location: location || '', isReversal });
    };

    const updateLudlowQuantity = async (sku: string, delta: number, location?: string | null) => {
        await updateQuantity(sku, delta, 'LUDLOW', location);
    };

    const updateAtsQuantity = async (sku: string, delta: number, location?: string | null) => {
        await updateQuantity(sku, delta, 'ATS', location);
    };

    const addItem = async (warehouse: string, newItem: any) => {
        await mutAddItem.mutateAsync({ warehouse, newItem });
    };

    const updateItem = async (originalItem: any, updatedFormData: any) => {
        await mutUpdateItem.mutateAsync({ originalItem, updatedFormData });
    };

    const moveItem = async (sourceItem: any, targetWarehouse: string, targetLocation: string, qty: number, _isReversal?: boolean) => {
        await mutMoveItem.mutateAsync({ sourceItem, targetWarehouse, targetLocation, qty });
    };

    const deleteItem = async (warehouse: string, sku: string, location?: string | null) => {
        await mutDeleteItem.mutateAsync({ warehouse, sku, location });
    };

    const processPickingList = async (listId: string, palletsQty: number, totalUnits: number) => {
        await mutProcessPickingList.mutateAsync({ listId, palletsQty, totalUnits });
    };

    const exportData = () => { };
    const syncInventoryLocations = async () => { return { successCount: 0, failCount: 0 }; };

    // Estos metodos no tienen sentido en React Query porque la caché manda:
    const updateInventory = () => { };
    const updateLudlowInventory = (_updates: any) => { };
    const updateAtsInventory = (_updates: any) => { };

    const updateSKUMetadata = async (metadata: SKUMetadataInput) => {
        await inventoryApi.upsertMetadata(metadata);
    };

    const syncFilters = (_filters?: any) => { };

    const getAvailableStock = (sku: string, warehouse = 'LUDLOW') => {
        const item = globalData.find(i => i.sku === sku && i.warehouse === warehouse);
        return item?.quantity || 0;
    };

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
        exportData,
        syncInventoryLocations,
        updateInventory,
        updateLudlowInventory,
        updateAtsInventory,
        syncFilters,
        showInactive,
        setShowInactive,
        isAdmin,
        user,
        profile
    };
};
