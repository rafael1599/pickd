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
  myCustomerName: string | null
) {
  const insufficientSkus = cartItems
    .filter((i) => i.insufficient_stock)
    .map((i) => i.sku);

  return useQuery({
    queryKey: ['waiting-conflicts', activeListId, insufficientSkus.sort().join(',')],
    queryFn: async (): Promise<WaitingConflict[]> => {
      if (insufficientSkus.length === 0) return [];

      const { data, error } = await supabase
        .from('picking_lists')
        .select('id, order_number, items, customer:customers(name)')
        .eq('is_waiting_inventory', true)
        .neq('id', activeListId ?? '');

      if (error) throw error;
      if (!data || data.length === 0) return [];

      const conflicts: WaitingConflict[] = [];
      const insufficientSet = new Set(insufficientSkus);

      for (const waitingOrder of data) {
        const customerName = (waitingOrder.customer as { name: string } | null)?.name ?? 'Unknown';

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
