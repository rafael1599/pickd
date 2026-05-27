// idea-053: Detect cross-customer SKU conflicts with waiting orders.
//
// When a checker opens an order in DoubleCheckView, this hook checks whether
// any insufficient_stock items are reserved by a DIFFERENT customer's waiting
// order. If so, the checker must decide: take over the SKU or edit their order.
//
// Same-customer conflicts don't exist because the watchdog auto-merges.

import { useQuery } from '@tanstack/react-query';
import { supabase } from '../../../lib/supabase';

interface WaitingOrderItem {
  sku: string;
  pickingQty: number;
}

export interface WaitingConflict {
  sku: string;
  myQty: number;
  waitingListId: string;
  waitingOrderNumber: string;
  waitingCustomerName: string;
  waitingQty: number;
}

export function useWaitingConflicts(
  cartItems: { sku: string; pickingQty: number; insufficient_stock?: boolean }[],
  activeListId: string | null,
  myCustomerName: string | null,
  /**
   * idea-119: if the active list belongs to a combined order group, pass
   * the group id so we skip every sibling list — they were already merged
   * into the current cart and should not show as a "waiting in another
   * order" conflict.
   */
  myGroupId: string | null = null
) {
  const insufficientSkus = cartItems.filter((i) => i.insufficient_stock).map((i) => i.sku);

  return useQuery({
    queryKey: ['waiting-conflicts', activeListId, myGroupId, insufficientSkus.sort().join(',')],
    queryFn: async (): Promise<WaitingConflict[]> => {
      if (insufficientSkus.length === 0) return [];

      const { data, error } = await supabase
        .from('picking_lists')
        .select('id, order_number, items, group_id, customer:customers(name)')
        .eq('is_waiting_inventory', true)
        .neq('id', activeListId ?? '');

      if (error) throw error;
      if (!data || data.length === 0) return [];

      const conflicts: WaitingConflict[] = [];
      const insufficientSet = new Set(insufficientSkus);

      for (const waitingOrder of data) {
        const customerName = (waitingOrder.customer as { name: string } | null)?.name ?? 'Unknown';

        // idea-119: skip siblings of the same combined order. They share
        // the cart with the active list, so listing them as conflicts shows
        // false warnings to the picker.
        if (myGroupId && (waitingOrder as { group_id?: string | null }).group_id === myGroupId) {
          continue;
        }

        // Skip same-customer (auto-merged by watchdog, not a conflict)
        if (myCustomerName && customerName.toLowerCase() === myCustomerName.toLowerCase()) continue;

        const waitingItems = (waitingOrder.items ?? []) as unknown as WaitingOrderItem[];
        for (const wItem of waitingItems) {
          if (insufficientSet.has(wItem.sku)) {
            const myItem = cartItems.find((i) => i.sku === wItem.sku);
            conflicts.push({
              sku: wItem.sku,
              myQty: myItem?.pickingQty ?? 0,
              waitingListId: waitingOrder.id,
              waitingOrderNumber: waitingOrder.order_number ?? 'N/A',
              waitingCustomerName: customerName,
              waitingQty: wItem.pickingQty,
            });
          }
        }
      }

      return conflicts;
    },
    enabled: !!activeListId && insufficientSkus.length > 0,
    staleTime: 30_000,
  });
}
