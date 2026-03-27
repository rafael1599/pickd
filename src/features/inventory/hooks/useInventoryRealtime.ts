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

const BIKE_LOCATION_RE = /^ROW\s|^PALLETIZED$|^UNASSIGNED$/i;

function isPartsBinLocation(location: string | null | undefined): boolean {
  return !!location && !BIKE_LOCATION_RE.test(location.trim());
}

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
      queryClient.setQueryData(cacheKey, (oldData: InventoryItemWithMetadata[] | undefined) => {
        if (!oldData) return oldData;

        const newRecord = payload.new as Record<string, unknown>;
        const oldRecord = payload.old as Record<string, unknown>;

        if (payload.eventType === 'INSERT') {
          const exists = oldData.some((item) => item.id === newRecord.id);
          if (exists) return oldData;
          return [newRecord as InventoryItemWithMetadata, ...oldData];
        }

        if (payload.eventType === 'UPDATE') {
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
      queryClient.setQueryData(cacheKey, (oldData: InventoryItemWithMetadata[] | undefined) => {
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
        const record = (payload.new || payload.old) as Record<string, unknown>;
        const location = record?.location as string | null;
        const targetKey = isPartsBinLocation(location) ? PARTS_BINS_KEY : INVENTORY_ROOT_KEY;
        applyInventoryChange(targetKey, payload);
      })
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'sku_metadata' },
        (payload) => {
          const newMeta = payload.new as SKUMetadata;
          if (payload.eventType === 'UPDATE' || payload.eventType === 'INSERT') {
            // Update both caches since a SKU can appear in either
            applyMetadataChange(INVENTORY_ROOT_KEY, newMeta);
            applyMetadataChange(PARTS_BINS_KEY, newMeta);
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [queryClient]);
}
