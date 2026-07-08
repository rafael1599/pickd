import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../../../lib/supabase';
import { withSupabaseRetry } from '../../../lib/supabaseRetry';
import { autoClassifyShippingType } from '../../../utils/shippingClassification';

/**
 * A single line-item inside an order's `items` JSON array. Every field is
 * optional because the shape varies across import sources (watchdog PDF
 * import, manual entry, AS400). Consumers must guard for undefined.
 */
export interface OrderItem {
  sku?: string;
  raw_sku?: string;
  item_name?: string;
  description?: string;
  pickingQty?: number;
  unit_price?: number;
  location?: string;
}

/**
 * Read-only projection of a `picking_lists` row plus the joined customer and
 * order_group. Mirrors the select used by ShipScreen so the Orders board and
 * the label editor stay data-compatible.
 */
export interface OrderRow {
  id: string;
  order_number: string | null;
  customer_id: string | null;
  status: string;
  items: OrderItem[] | null;
  notes: string | null;
  source_order_date: string | null;
  shipping_type: string | null;
  pallets_qty: number | null;
  total_units: number | null;
  created_at: string;
  updated_at: string;
  customer: {
    id: string;
    name: string;
    street: string | null;
    city: string | null;
    state: string | null;
    zip_code: string | null;
    phone: string | null;
  } | null;
  order_group: { group_type: string | null } | null;
}

/**
 * True when an order ships via FedEx. Precedence:
 *   1. Explicit group type ('fedex').
 *   2. Explicit shipping_type ('fedex').
 *   3. Auto-classification of the items when no shipping_type is set.
 */
export function isFedexOrder(o: OrderRow): boolean {
  return (
    o.order_group?.group_type === 'fedex' ||
    o.shipping_type === 'fedex' ||
    (!o.shipping_type &&
      autoClassifyShippingType((o.items ?? []) as { sku: string; pickingQty: number }[], {}) ===
        'fedex')
  );
}

interface UseOrdersOfDayResult {
  orders: OrderRow[];
  loading: boolean;
  refetch: () => Promise<void>;
}

/**
 * Fetches ALL orders (no server-side date filter) so client-side search can
 * reach older orders. The screen narrows to "today" by default. Keeps the
 * list live via a `picking_lists` realtime subscription.
 */
export function useOrdersOfDay(): UseOrdersOfDayResult {
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [loading, setLoading] = useState(true);

  const refetch = useCallback(async () => {
    try {
      const query = supabase
        .from('picking_lists')
        .select(
          `
          *,
          customer:customers(id, name, street, city, state, zip_code, phone),
          order_group:order_groups(group_type)
        `
        )
        .order('created_at', { ascending: false });

      const { data, error } = await withSupabaseRetry(() => query, {
        label: 'useOrdersOfDay',
      });

      if (error) throw error;

      setOrders((data ?? []) as unknown as OrderRow[]);
    } catch (err) {
      console.error('[useOrdersOfDay] failed to load orders:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refetch();

    const channel = supabase
      .channel('orders-board')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'picking_lists' }, () => {
        refetch();
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [refetch]);

  return { orders, loading, refetch };
}
