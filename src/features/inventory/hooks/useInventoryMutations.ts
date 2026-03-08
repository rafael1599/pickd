import { useMutation, useQueryClient } from '@tanstack/react-query';
import { inventoryService } from '../api/inventory.service';
import { type InventoryItemInput, type InventoryItemWithMetadata } from '../../../schemas/inventory.schema';
import { useAuth } from '../../../context/AuthContext';
import { useLocationManagement } from './useLocationManagement';
import { INVENTORY_ROOT_KEY } from './useInventoryRealtime';
import toast from 'react-hot-toast';

export function useInventoryMutations() {
    const queryClient = useQueryClient();
    const { user, profile } = useAuth();
    const { locations } = useLocationManagement();

    const userName = profile?.full_name || user?.email || 'Warehouse Team';

    const getServiceContext = () => ({
        isAdmin: profile?.role === 'admin' || profile?.role === 'manager',
        userInfo: { performed_by: userName, user_id: user?.id },
        trackLog: async () => 'log_id', // Mocked or connected to actual log system if needed. Logs usually run inside service via trackLog, but the service handles it internally if we provide it.
    });

    const updateQuantity = useMutation({
        mutationKey: ['inventory', 'updateQuantity'],
        mutationFn: async (vars: { sku: string; delta: number; warehouse: string; location: string | null; isReversal?: boolean }) => {
            const { data, error } = await (inventoryService as any).supabase.rpc('adjust_inventory_quantity', {
                p_sku: vars.sku,
                p_warehouse: vars.warehouse,
                p_location: vars.location || '',
                p_delta: vars.delta,
                p_performed_by: userName,
                p_user_id: user?.id || null,
                p_user_role: profile?.role || 'staff'
            });
            if (error) throw error;
            return data;
        },
        onMutate: async (vars) => {
            await queryClient.cancelQueries({ queryKey: INVENTORY_ROOT_KEY });
            const previousData = queryClient.getQueryData<InventoryItemWithMetadata[]>(INVENTORY_ROOT_KEY);

            // Optimistic update
            queryClient.setQueryData(INVENTORY_ROOT_KEY, (old: InventoryItemWithMetadata[] | undefined) => {
                if (!old) return old;
                return old.map(item =>
                    item.sku === vars.sku && item.warehouse === vars.warehouse && (item.location || '').toUpperCase() === (vars.location || '').toUpperCase()
                        ? { ...item, quantity: (item.quantity || 0) + vars.delta, _lastLocalUpdateAt: Date.now() }
                        : item
                );
            });

            return { previousData };
        },
        onError: (err, _vars, context) => {
            if (context?.previousData) {
                queryClient.setQueryData(INVENTORY_ROOT_KEY, context.previousData);
            }
            toast.error(`Error updating quantity: ${err.message}`);
        },
        onSettled: () => {
            // Let realtime Websocket handle the actual sync to avoid full refetch
        }
    });

    const addItem = useMutation({
        mutationKey: ['inventory', 'addItem'],
        mutationFn: async (vars: { warehouse: string; newItem: InventoryItemInput }) => {
            return inventoryService.addItem(vars.warehouse, vars.newItem, locations, getServiceContext() as any);
        },
        onMutate: async (vars) => {
            await queryClient.cancelQueries({ queryKey: INVENTORY_ROOT_KEY });
            const previousData = queryClient.getQueryData<InventoryItemWithMetadata[]>(INVENTORY_ROOT_KEY);

            const optimisticId = -Math.floor(Math.random() * 1000000);

            queryClient.setQueryData(INVENTORY_ROOT_KEY, (old: InventoryItemWithMetadata[] | undefined) => {
                const newItemMock: InventoryItemWithMetadata = {
                    id: optimisticId,
                    sku: vars.newItem.sku,
                    warehouse: vars.warehouse as any,
                    location: (vars.newItem.location || '').toUpperCase(),
                    quantity: vars.newItem.quantity,
                    item_name: vars.newItem.item_name,
                    is_active: true,
                    created_at: new Date() as any,
                    _lastLocalUpdateAt: Date.now(),
                    distribution: []
                };
                return old ? [newItemMock, ...old] : [newItemMock];
            });

            return { previousData };
        },
        onError: (err, _vars, context) => {
            if (context?.previousData) queryClient.setQueryData(INVENTORY_ROOT_KEY, context.previousData);
            toast.error(`Error adding item: ${err.message}`);
        }
    });

    const updateItem = useMutation({
        mutationKey: ['inventory', 'updateItem'],
        mutationFn: async (vars: { originalItem: InventoryItemWithMetadata; updatedFormData: InventoryItemInput }) => {
            return inventoryService.updateItem(vars.originalItem, vars.updatedFormData, locations, getServiceContext() as any);
        },
        onMutate: async (vars) => {
            await queryClient.cancelQueries({ queryKey: INVENTORY_ROOT_KEY });
            const previousData = queryClient.getQueryData<InventoryItemWithMetadata[]>(INVENTORY_ROOT_KEY);

            queryClient.setQueryData(INVENTORY_ROOT_KEY, (old: InventoryItemWithMetadata[] | undefined) => {
                if (!old) return old;
                return old.map(item =>
                    item.id === vars.originalItem.id
                        ? { ...item, ...vars.updatedFormData, location: (vars.updatedFormData.location || '').toUpperCase() }
                        : item
                );
            });
            return { previousData };
        },
        onError: (err, _vars, context) => {
            if (context?.previousData) queryClient.setQueryData(INVENTORY_ROOT_KEY, context.previousData);
            toast.error(`Error updating item: ${err.message}`);
        }
    });

    const deleteItem = useMutation({
        mutationKey: ['inventory', 'deleteItem'],
        mutationFn: async (vars: { sku: string; warehouse: string; location?: string | null }) => {
            const items = queryClient.getQueryData<InventoryItemWithMetadata[]>(INVENTORY_ROOT_KEY) || [];
            const item = items.find(i => i.sku === vars.sku && i.warehouse === vars.warehouse && (vars.location ? i.location === vars.location : true));
            if (!item) throw new Error("Item not found");
            return inventoryService.deleteItem(item, getServiceContext() as any);
        },
        onMutate: async (vars) => {
            await queryClient.cancelQueries({ queryKey: INVENTORY_ROOT_KEY });
            const previousData = queryClient.getQueryData<InventoryItemWithMetadata[]>(INVENTORY_ROOT_KEY);

            queryClient.setQueryData(INVENTORY_ROOT_KEY, (old: InventoryItemWithMetadata[] | undefined) => {
                if (!old) return old;
                return old.filter(item => !(item.sku === vars.sku && item.warehouse === vars.warehouse && (vars.location ? item.location === vars.location : true)));
            });
            return { previousData };
        },
        onError: (err, _vars, context) => {
            if (context?.previousData) queryClient.setQueryData(INVENTORY_ROOT_KEY, context.previousData);
            toast.error(`Error deleting item: ${err.message}`);
        }
    });

    return {
        updateQuantity,
        addItem,
        updateItem,
        deleteItem
    };
}
