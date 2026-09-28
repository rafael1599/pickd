import { useMemo, useEffect, useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../../../lib/supabase';

// Define the shape of items in the JSONB column
// We assume it's an array of items with at least some basic properties
export interface PickingItem {
  sku: string;
  qty: number;
  location?: string;
  [key: string]: string | number | boolean | null | undefined;
}

export interface Profile {
  full_name: string | null;
}

export interface OrderGroup {
  id: string;
  group_type: string;
}

export interface PickingList {
  id: string;
  order_number: string;
  status:
    | 'active'
    | 'ready_to_double_check'
    | 'double_checking'
    | 'needs_correction'
    | 'completed'
    | 'cancelled';
  items: PickingItem[];
  created_at: string;
  updated_at: string;
  user_id: string;
  checked_by: string | null;
  profiles?: Profile | null; // Joined profile
  checker_profile?: Profile | null; // Joined checker profile
  customer_id?: string | null;
  customer?: { name: string } | null;
  source?: string;
  is_addon?: boolean;
  group_id?: string | null;
  order_group?: OrderGroup | null;
  is_waiting_inventory?: boolean;
  waiting_reason?: string | null;
  shipping_type?: string | null;
  pallets_qty?: number | null;
  total_units?: number | null;
  source_order_date?: string | null;
  transport_company?: string | null;
  load_number?: string | null;
  is_shipped?: boolean;
  verified_item_keys?: string[] | null;
  notes?: string | null;
  shipment_id?: string | null;
  shipment?: {
    id: string;
    pallets_qty: number;
    total_weight_lbs?: number | null;
    load_number?: string | null;
    transport_company?: string | null;
    is_shipped?: boolean;
  } | null;
  /** Client-only, set by `mergeGroupOrders` on a combined card: every member, so
   *  the card reads each one's notes and not just the anchor's. */
  members?: { id: string; order_number: string; notes: string | null }[];
}

const PICKING_LIST_SELECT = `
  id,
  order_number,
  status,
  items,
  created_at,
  updated_at,
  user_id,
  checked_by,
  profiles!user_id (full_name),
  checker_profile:profiles!checked_by (full_name),
  customer_id,
  customer:customers(name),
  source,
  is_addon,
  group_id,
  order_group:order_groups(id, group_type),
  is_waiting_inventory,
  waiting_reason,
  shipping_type,
  pallets_qty,
  total_units,
  source_order_date,
  transport_company,
  load_number,
  is_shipped,
  verified_item_keys,
  notes,
  shipment_id,
  shipment:shipments(
    id,
    pallets_qty,
    total_weight_lbs,
    load_number,
    transport_company,
    is_shipped
  )
`;

export const VERIFICATION_QUEUE_KEY = ['picking_lists', 'verification_queue'];
export const COMPLETED_ORDERS_KEY = ['picking_lists', 'completed_recent'];

export const BOARD_COUNT_KEY = ['picking_lists', 'board_count'];

const BOARD_STATUSES = ['active', 'ready_to_double_check', 'double_checking', 'needs_correction'];
const REALTIME_DEBOUNCE_MS = 500;

const fetchVerificationQueue = async (): Promise<PickingList[]> => {
  const { data, error } = await // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (supabase.from('picking_lists').select(PICKING_LIST_SELECT) as any)
    .in('status', BOARD_STATUSES)
    .or('is_shipped.is.null,is_shipped.eq.false')
    .order('updated_at', { ascending: false });

  if (error) throw error;
  // Active orders are always shown (even with empty items) so manually-created
  // orders are visible. Other statuses still require items to be present.
  return ((data ?? []) as PickingList[]).filter(
    (o) => o.status === 'active' || (o.items && Array.isArray(o.items) && o.items.length > 0)
  );
};

const fetchCompletedRecent = async (): Promise<PickingList[]> => {
  const { data, error } = await // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (supabase.from('picking_lists').select(PICKING_LIST_SELECT) as any)
    .eq('status', 'completed')
    .or('is_shipped.is.null,is_shipped.eq.false')
    .order('updated_at', { ascending: false })
    // Wide enough to cover a full day's completions; the board splits
    // "today" vs "recent" client-side (recent shows with date labels
    // when the board has no active orders).
    .limit(30);

  if (error) throw error;
  return (data as PickingList[]) || [];
};

/**
 * The same number as `fetchVerificationQueue().length` — the same statuses,
 * not shipped, and an order with no items counts only while `active` — asked
 * as a count, so the nav badge never downloads every open order's `items`.
 */
const fetchBoardCount = async (): Promise<number> => {
  const { count, error } = await supabase
    .from('picking_lists')
    .select('id', { count: 'exact', head: true })
    .in('status', BOARD_STATUSES)
    .or('is_shipped.is.null,is_shipped.eq.false')
    .or('status.eq.active,and(items.not.is.null,items.neq.[])');

  if (error) throw error;
  return count ?? 0;
};

/**
 * One realtime channel on `picking_lists` whose events collapse into a single
 * invalidation once a burst goes quiet (idea-191): a bulk write fires one event
 * per row, and each one used to refetch immediately.
 */
const usePickingListsInvalidation = (channelPrefix: string, queryKeys: readonly string[][]) => {
  const queryClient = useQueryClient();

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    // Unique channel name per mount to avoid stale channel conflicts on re-open
    const channelName = `${channelPrefix}_${Date.now()}`;
    const channel = supabase
      .channel(channelName)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'picking_lists' }, () => {
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => {
          timer = null;
          queryKeys.forEach((queryKey) => queryClient.invalidateQueries({ queryKey }));
        }, REALTIME_DEBOUNCE_MS);
      })
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          console.log(`✅ [VerificationQueue] Realtime subscribed: ${channelName}`);
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          console.error(`❌ [VerificationQueue] Realtime ${status}: ${channelName}`);
        }
      });

    return () => {
      if (timer) clearTimeout(timer);
      supabase.removeChannel(channel);
    };
  }, [channelPrefix, queryKeys, queryClient]);
};

const BOARD_COUNT_KEYS = [BOARD_COUNT_KEY] as const;
const QUEUE_KEYS = [VERIFICATION_QUEUE_KEY, COMPLETED_ORDERS_KEY] as const;

/**
 * The nav badge: every order on the Live Board, as a count. `prefetchBoard`
 * warms the board's two queries on the first sign of a tap, so opening it
 * does not start cold now that nothing keeps them mounted.
 */
export const useBoardCount = () => {
  const queryClient = useQueryClient();

  const { data: boardCount } = useQuery<number>({
    queryKey: BOARD_COUNT_KEY,
    queryFn: fetchBoardCount,
    staleTime: 0,
    refetchOnWindowFocus: true,
  });

  usePickingListsInvalidation('picking_lists_board_count', BOARD_COUNT_KEYS);

  const prefetchBoard = useCallback(() => {
    void queryClient.prefetchQuery({
      queryKey: VERIFICATION_QUEUE_KEY,
      queryFn: fetchVerificationQueue,
      staleTime: 10_000,
    });
    void queryClient.prefetchQuery({
      queryKey: COMPLETED_ORDERS_KEY,
      queryFn: fetchCompletedRecent,
      staleTime: 10_000,
    });
  }, [queryClient]);

  const refresh = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: BOARD_COUNT_KEY });
    queryClient.invalidateQueries({ queryKey: VERIFICATION_QUEUE_KEY });
    queryClient.invalidateQueries({ queryKey: COMPLETED_ORDERS_KEY });
  }, [queryClient]);

  return { boardCount: boardCount ?? 0, prefetchBoard, refresh };
};

export const useDoubleCheckList = () => {
  const queryClient = useQueryClient();

  const { data: rawOrders, isLoading: ordersLoading } = useQuery<PickingList[]>({
    queryKey: VERIFICATION_QUEUE_KEY,
    queryFn: fetchVerificationQueue,
    staleTime: 0,
    refetchOnWindowFocus: true,
  });

  const { data: completedOrders, isLoading: completedLoading } = useQuery<PickingList[]>({
    queryKey: COMPLETED_ORDERS_KEY,
    queryFn: fetchCompletedRecent,
    staleTime: 0,
    refetchOnWindowFocus: true,
  });

  usePickingListsInvalidation('picking_lists_queue', QUEUE_KEYS);

  const orders = useMemo(() => rawOrders ?? [], [rawOrders]);

  // Every order on the Live Board (Rafael, 9 sep 2026: "cada orden que esta en
  // live board debe ser contada"). The query above already IS the board's
  // non-completed set, and the board files each row into exactly one zone —
  // Available, Pulling, FedEx, Regular, Waiting — so its length is the whole
  // board and no zone can be left out of the total by forgetting a status.
  // Summing per-status buckets is what let 'active' and 'double_checking' fall
  // through twice.
  const boardCount = orders.length;

  const refresh = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: VERIFICATION_QUEUE_KEY });
    queryClient.invalidateQueries({ queryKey: COMPLETED_ORDERS_KEY });
  }, [queryClient]);

  return {
    orders,
    completedOrders: completedOrders ?? [],
    boardCount,
    loading: ordersLoading || completedLoading,
    refresh,
  };
};
