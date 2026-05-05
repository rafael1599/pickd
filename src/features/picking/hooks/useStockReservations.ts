import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../../../lib/supabase';

export interface ReservingOrder {
  orderNumber: string;
  listId: string;
  qty: number;
  customerName: string | null;
  isWaiting: boolean;
  picked: boolean;
  pickedAt: string | null;
}

export interface ReservationInfo {
  stock: number;
  reserved: number;
  picked: number;
  reservingOrders: ReservingOrder[];
}

export type ReservationsMap = Map<string, ReservationInfo>;

const ACTIVE_STATES = [
  'active',
  'needs_correction',
  'ready_to_double_check',
  'double_checking',
] as const;

export const buildReservationKey = (
  sku: string | null | undefined,
  warehouse: string | null | undefined,
  location: string | null | undefined
): string => `${sku ?? ''}::${warehouse ?? ''}::${(location ?? '').toUpperCase()}`;

interface InventoryRow {
  sku: string;
  warehouse: string;
  location: string | null;
  quantity: number | null;
}

interface PickingItemRow {
  sku?: string;
  warehouse?: string;
  location?: string | null;
  pickingQty?: number;
  picked?: boolean;
  picked_at?: string | null;
}

interface PickingListRow {
  id: string;
  order_number: string | null;
  items: PickingItemRow[] | null;
  is_waiting_inventory: boolean | null;
  customers?: { name: string | null } | null;
}

/**
 * idea-105 Phase 3 — cross-order reservation visibility.
 *
 * Given a list of `${sku}::${warehouse}::${LOCATION}` keys, returns a Map with
 * `{ stock, reserved, picked, reservingOrders }` per key. `excludeListId`
 * removes the caller's own list so it doesn't count itself.
 *
 * Freshness: subscribes to Realtime postgres_changes on `picking_lists` while
 * mounted. Any change anywhere invalidates this hook's queryKey → refetch.
 * Cleans up the channel on unmount so we don't leak subscriptions.
 */
export const useStockReservations = (itemKeys: string[], excludeListId: string | null) => {
  const sortedKeys = [...itemKeys].sort();
  const queryClient = useQueryClient();
  const enabled = sortedKeys.length > 0;

  useEffect(() => {
    if (!enabled) return;
    const channelName = `stock-reservations-${Math.random().toString(36).slice(2, 9)}`;
    const channel = supabase
      .channel(channelName)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'picking_lists' }, () => {
        queryClient.invalidateQueries({ queryKey: ['picking_lists', 'reservations'] });
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'inventory' }, () => {
        queryClient.invalidateQueries({ queryKey: ['picking_lists', 'reservations'] });
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [enabled, queryClient]);

  return useQuery<ReservationsMap>({
    queryKey: ['picking_lists', 'reservations', { keys: sortedKeys, excludeListId }],
    enabled: sortedKeys.length > 0,
    staleTime: 10_000,
    queryFn: async () => {
      const skuSet = new Set<string>();
      const parsed = sortedKeys.map((k) => {
        const [sku, warehouse, location] = k.split('::');
        if (sku) skuSet.add(sku);
        return { key: k, sku, warehouse, location };
      });
      const skus = Array.from(skuSet);

      const [invResult, listsResult] = await Promise.all([
        supabase.from('inventory').select('sku, warehouse, location, quantity').in('sku', skus),
        (() => {
          const q = supabase
            .from('picking_lists')
            .select('id, order_number, items, is_waiting_inventory, customers(name)')
            .in('status', ACTIVE_STATES as unknown as string[]);
          return excludeListId ? q.neq('id', excludeListId) : q;
        })(),
      ]);

      const invRows = (invResult.data as InventoryRow[] | null) ?? [];
      const lists = (listsResult.data as unknown as PickingListRow[] | null) ?? [];

      const map: ReservationsMap = new Map();
      parsed.forEach(({ key, sku, warehouse, location }) => {
        const inv = invRows.find(
          (r) =>
            r.sku === sku &&
            (r.warehouse ?? '') === warehouse &&
            (r.location ?? '').toUpperCase() === (location ?? '').toUpperCase()
        );
        map.set(key, {
          stock: Number(inv?.quantity ?? 0),
          reserved: 0,
          picked: 0,
          reservingOrders: [],
        });
      });

      lists.forEach((list) => {
        const items = list.items ?? [];
        items.forEach((it) => {
          const key = buildReservationKey(it.sku, it.warehouse, it.location);
          const entry = map.get(key);
          if (!entry) return;
          const qty = Number(it.pickingQty ?? 0);
          if (qty <= 0) return;
          const picked = !!it.picked;
          if (picked) entry.picked += qty;
          else entry.reserved += qty;
          entry.reservingOrders.push({
            orderNumber: list.order_number ?? '',
            listId: list.id,
            qty,
            customerName: list.customers?.name ?? null,
            isWaiting: !!list.is_waiting_inventory,
            picked,
            pickedAt: it.picked_at ?? null,
          });
        });
      });

      return map;
    },
  });
};
