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
  location?: string | null;
  sublocation?: string[] | null;
}

/**
 * Read-only projection of a `picking_lists` row plus the joined customer,
 * order_group and picker/checker profiles. Mirrors the select used by
 * ShipScreen so the Orders board and the label editor stay data-compatible.
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
  load_number: string | null;
  created_at: string;
  updated_at: string;
  user_id: string | null;
  checked_by: string | null;
  transport_company: string | null;
  total_weight_lbs: number | null;
  pallet_photos: string[] | null;
  is_waiting_inventory: boolean | null;
  is_shipped?: boolean | null;
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
  user: { full_name: string | null } | null;
  checker: { full_name: string | null } | null;
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

/**
 * Splits an order's line items into bikes vs parts by summing `pickingQty`,
 * using the `is_bike` lookup built from `sku_metadata`. Mirrors the calc in
 * ShipScreen so both surfaces agree.
 */
export function computeBikesParts(
  order: OrderRow,
  skuIsBike: Record<string, boolean>
): { bikes: number; parts: number } {
  let bikes = 0;
  let parts = 0;
  for (const item of order.items ?? []) {
    const qty = item.pickingQty ?? 0;
    if (qty <= 0) continue;
    const sku = item.sku ?? item.raw_sku ?? '';
    if (skuIsBike[sku]) bikes += qty;
    else parts += qty;
  }
  return { bikes, parts };
}

interface UseOrdersOfDayResult {
  orders: OrderRow[];
  skuIsBike: Record<string, boolean>;
  loading: boolean;
  refetch: () => Promise<void>;
}

/**
 * Fetches ALL orders (no server-side date filter) so client-side search can
 * reach older orders. The screen narrows to "today" by default. Keeps the
 * list live via a `picking_lists` realtime subscription. Also batch-fetches
 * `sku_metadata` to expose an `is_bike` lookup for bikes/parts summaries.
 */
export function useOrdersOfDay(): UseOrdersOfDayResult {
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [skuIsBike, setSkuIsBike] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);

  const refetch = useCallback(async () => {
    try {
      const query = supabase
        .from('picking_lists')
        .select(
          `
          *,
          customer:customers(id, name, street, city, state, zip_code, phone),
          order_group:order_groups(group_type),
          user:profiles!user_id(full_name),
          checker:profiles!checked_by(full_name)
        `
        )
        .order('created_at', { ascending: false });

      const { data, error } = await withSupabaseRetry(() => query, {
        label: 'useOrdersOfDay',
      });

      if (error) throw error;

      const loaded = (data ?? []) as unknown as OrderRow[];
      setOrders(loaded);

      // Collect the distinct set of SKUs across all orders and batch-fetch
      // their is_bike classification so cards can show bikes/parts counts.
      const skus = Array.from(
        new Set(
          loaded.flatMap((o) =>
            (o.items ?? [])
              .map((i) => i.sku ?? i.raw_sku ?? '')
              .filter((s): s is string => s.length > 0)
          )
        )
      );

      if (skus.length > 0) {
        const { data: metaData, error: metaError } = await withSupabaseRetry(
          () => supabase.from('sku_metadata').select('sku, is_bike').in('sku', skus),
          { label: 'useOrdersOfDay.skuMeta' }
        );
        if (metaError) throw metaError;
        const map: Record<string, boolean> = {};
        (metaData as { sku: string; is_bike: boolean | null }[] | null)?.forEach((row) => {
          map[row.sku] = row.is_bike ?? false;
        });
        setSkuIsBike(map);
      } else {
        setSkuIsBike({});
      }
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

  return { orders, skuIsBike, loading, refetch };
}
