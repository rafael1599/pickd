import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '../../../lib/supabase';
import { type InventoryItemWithMetadata } from '../../../schemas/inventory.schema';

export const INVENTORY_ROOT_KEY = ['inventory', 'grouped-all'];

/**
 * Motor Websocket: Escucha cambios en 'inventory' y 'sku_metadata'
 * e inyecta quirúrgicamente los datos en la caché de React Query
 * sin causar recargas completas.
 */
export function useInventoryRealtime() {
    const queryClient = useQueryClient();

    useEffect(() => {
        const channel = supabase.channel('inventory-sync-dual')
            .on('postgres_changes', { event: '*', schema: 'public', table: 'inventory' }, (payload) => {
                queryClient.setQueryData(INVENTORY_ROOT_KEY, (oldData: InventoryItemWithMetadata[] | undefined) => {
                    if (!oldData) return oldData;

                    const newRecord = payload.new as any;
                    const oldRecord = payload.old;
                    const eventType = payload.eventType;

                    if (eventType === 'INSERT') {
                        // Evita duplicados si la UI ya hizo una actualización optimista
                        const exists = oldData.some(item => item.id === newRecord.id);
                        if (exists) return oldData;
                        return [newRecord, ...oldData];
                    }

                    if (eventType === 'UPDATE') {
                        return oldData.map(item =>
                            item.id === newRecord.id
                                // Mantiene la metadata antigua, que no viaja en el payload de 'inventory'
                                ? { ...item, ...newRecord, sku_metadata: item.sku_metadata }
                                : item
                        );
                    }

                    if (eventType === 'DELETE') {
                        return oldData.filter(item => item.id !== (oldRecord as any).id);
                    }

                    return oldData;
                });
            })
            .on('postgres_changes', { event: '*', schema: 'public', table: 'sku_metadata' }, (payload) => {
                queryClient.setQueryData(INVENTORY_ROOT_KEY, (oldData: InventoryItemWithMetadata[] | undefined) => {
                    if (!oldData) return oldData;

                    const newMeta = payload.new as any;
                    const eventType = payload.eventType;

                    if (eventType === 'UPDATE' || eventType === 'INSERT') {
                        let hasChanges = false;
                        const updatedData = oldData.map(item => {
                            if (item.sku === newMeta.sku) {
                                hasChanges = true;
                                return { ...item, sku_metadata: newMeta };
                            }
                            return item;
                        });
                        return hasChanges ? updatedData : oldData;
                    }

                    return oldData;
                });
            })
            .subscribe();

        return () => {
            supabase.removeChannel(channel);
        };
    }, [queryClient]);
}
