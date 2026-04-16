import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '../../../lib/supabase';
import {
  type InventoryItemWithMetadata,
  type InventoryItem,
} from '../../../schemas/inventory.schema';
import { type SKUMetadata } from '../../../schemas/skuMetadata.schema';

export const INVENTORY_ROOT_KEY = ['inventory', 'grouped-all'];
export const PARTS_BINS_KEY = ['inventory', 'parts-bins'];
export const SD_BINS_KEY = ['inventory', 'sd-bins'];

/**
 * Motor Websocket: Escucha cambios en 'inventory' y 'sku_metadata'
 * e inyecta quirúrgicamente los datos en la caché de React Query
 * sin causar recargas completas.
 */
export function useInventoryRealtime() {
  const queryClient = useQueryClient();

  useEffect(() => {
    function applyInventoryChange(
      cacheKey: string[],
      payload: { new: unknown; old: unknown; eventType: string }
    ) {
      queryClient.setQueriesData<InventoryItemWithMetadata[]>({ queryKey: cacheKey }, (oldData) => {
        if (!oldData) return oldData;

        const newRecord = payload.new as Record<string, unknown>;
        const oldRecord = payload.old as Record<string, unknown>;

        if (payload.eventType === 'INSERT') {
          const exists = oldData.some((item) => item.id === newRecord.id);
          if (exists) return oldData;
          if ((newRecord.quantity as number) <= 0) return oldData;
          return [newRecord as InventoryItemWithMetadata, ...oldData];
        }

        if (payload.eventType === 'UPDATE') {
          if ((newRecord.quantity as number) <= 0) {
            return oldData.filter((item) => item.id !== newRecord.id);
          }
          return oldData.map((item) =>
            item.id === newRecord.id
              ? {
                  ...item,
                  ...(newRecord as Partial<InventoryItem>),
                  sku_metadata: item.sku_metadata,
                }
              : item
          );
        }

        if (payload.eventType === 'DELETE') {
          return oldData.filter((item) => item.id !== oldRecord.id);
        }

        return oldData;
      });
    }

    function applyMetadataChange(cacheKey: string[], newMeta: SKUMetadata) {
      queryClient.setQueriesData<InventoryItemWithMetadata[]>({ queryKey: cacheKey }, (oldData) => {
        if (!oldData) return oldData;
        let hasChanges = false;
        const updatedData = oldData.map((item) => {
          if (item.sku === newMeta.sku) {
            hasChanges = true;
            return { ...item, sku_metadata: newMeta };
          }
          return item;
        });
        return hasChanges ? updatedData : oldData;
      });
    }

    const channel = supabase
      .channel('inventory-sync-dual')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'inventory' }, (payload) => {
        // Push to all caches — React rendering handles which view shows the item
        applyInventoryChange(INVENTORY_ROOT_KEY, payload);
        applyInventoryChange(PARTS_BINS_KEY, payload);
        applyInventoryChange(SD_BINS_KEY, payload);
      })
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'sku_metadata' },
        (payload) => {
          const newMeta = payload.new as SKUMetadata;
          if (payload.eventType === 'UPDATE' || payload.eventType === 'INSERT') {
            // Update all caches since a SKU can appear in any
            applyMetadataChange(INVENTORY_ROOT_KEY, newMeta);
            applyMetadataChange(PARTS_BINS_KEY, newMeta);
            applyMetadataChange(SD_BINS_KEY, newMeta);
            // The catalog screen (`/sd-catalog`) reads with its own keys —
            // invalidate when an S/D SKU changes.
            if (newMeta?.is_scratch_dent) {
              queryClient.invalidateQueries({ queryKey: ['sd-catalog'] });
            }
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [queryClient]);
}
