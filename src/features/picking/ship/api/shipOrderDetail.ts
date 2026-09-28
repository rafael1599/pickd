import type { QueryClient } from '@tanstack/react-query';
import { supabase } from '../../../../lib/supabase';
import { withSupabaseRetry } from '../../../../lib/supabaseRetry';
import { normalizeShipOrder, type OrderWithRelations } from '../hooks/useShipOrdersData';

/**
 * The open order on Ship, whole. The list carries a light row per order; this
 * completes the one on screen. `shipment` is embedded like in the list so the
 * card keeps reading the shipment's facts (shipments manda) instead of
 * swapping to the historical columns of `picking_lists` when this lands.
 */
export const SHIP_ORDER_DETAIL_SELECT = `
  *,
  customer:customers(id, name, street, city, state, zip_code),
  ship_to:customer_addresses!picking_lists_ship_to_address_id_fkey(id, label, street, city, state, zip_code),
  user:profiles!user_id(full_name),
  checker:profiles!checked_by(full_name),
  presence:user_presence!user_id(last_seen_at),
  order_group:order_groups(group_type),
  shipment:shipments(
    id,
    customer_id,
    ship_to_address_id,
    transport_company,
    load_number,
    pallets_qty,
    total_weight_lbs,
    pallet_dims,
    pallet_photos,
    is_shipped,
    shipped_at,
    created_at,
    updated_at
  )
`;

export const shipOrderDetailKey = (id: string) => ['ship-order', id] as const;

/** Detail rows are per order and cheap to refetch: never persist a week of them. */
const DETAIL_CACHE = { staleTime: 30_000, gcTime: 5 * 60_000, retry: false } as const;

function toDetail(data: unknown): OrderWithRelations {
  const row = data as OrderWithRelations;
  return normalizeShipOrder({ ...row, customer_details: row.customer || {} });
}

/** Throws on failure: the caller decides whether that is a toast or silence. */
export async function fetchShipOrderDetail(id: string): Promise<OrderWithRelations> {
  const { data, error } = await withSupabaseRetry(
    () => supabase.from('picking_lists').select(SHIP_ORDER_DETAIL_SELECT).eq('id', id).single(),
    { label: 'ShipScreen.fetchOrderDetail' }
  );
  if (error) throw error;
  return toDetail(data);
}

/** The detail from the cache when fresh, from the network otherwise. */
export function getShipOrderDetail(queryClient: QueryClient, id: string) {
  return queryClient.fetchQuery({
    queryKey: shipOrderDetailKey(id),
    queryFn: () => fetchShipOrderDetail(id),
    ...DETAIL_CACHE,
  });
}

export function prefetchShipOrderDetail(queryClient: QueryClient, id: string) {
  return queryClient.prefetchQuery({
    queryKey: shipOrderDetailKey(id),
    queryFn: () => fetchShipOrderDetail(id),
    ...DETAIL_CACHE,
  });
}

/** After a realtime echo: the next open of this order must read it again. */
export function markShipOrderDetailStale(queryClient: QueryClient, id: string) {
  return queryClient.invalidateQueries({ queryKey: shipOrderDetailKey(id), refetchType: 'none' });
}

function seed(queryClient: QueryClient, row: OrderWithRelations) {
  // Before creating the entry, so a seeded row gets the short gcTime too.
  queryClient.setQueryDefaults(['ship-order'], DETAIL_CACHE);
  queryClient.setQueryData(shipOrderDetailKey(row.id), row);
}

/**
 * The order Ship will open by itself, fetched whole in parallel with the list
 * so the card does not wait for the list first. It mirrors the auto-select rule
 * (`pickAutoSelectCandidate`): the newest completed order that is neither
 * shipped nor waiting. If the list ends up choosing another one — a combined
 * group, a filter — this is only a warm cache entry and the normal path runs.
 */
export async function prefetchAutoSelectCandidate(queryClient: QueryClient): Promise<void> {
  try {
    const { data } = await supabase
      .from('picking_lists')
      .select(SHIP_ORDER_DETAIL_SELECT)
      .eq('status', 'completed')
      .not('is_shipped', 'is', true)
      .not('is_waiting_inventory', 'is', true)
      .order('created_at', { ascending: false })
      .limit(1);
    const row = data?.[0];
    if (row) seed(queryClient, toDetail(row));
  } catch {
    // A warm-up only: the normal detail fetch runs if this fails.
  }
}

/** A deep link (`?order=881234`) opens that order: warm it while the search runs. */
export async function prefetchDetailByOrderNumber(
  queryClient: QueryClient,
  orderNumber: string
): Promise<void> {
  try {
    const { data } = await supabase
      .from('picking_lists')
      .select(SHIP_ORDER_DETAIL_SELECT)
      .neq('status', 'cancelled')
      .eq('order_number', orderNumber)
      .order('created_at', { ascending: false })
      .limit(1);
    const row = data?.[0];
    if (row) seed(queryClient, toDetail(row));
  } catch {
    // Same as above.
  }
}
