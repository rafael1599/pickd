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
    | 'ready_to_double_check'
    | 'double_checking'
    | 'needs_correction'
    | 'completed'
    | 'cancelled';
  items: PickingItem[];
  updated_at: string;
  user_id: string;
  checked_by: string | null;
  profiles?: Profile | null; // Joined profile
  checker_profile?: Profile | null; // Joined checker profile
  customer?: { name: string } | null;
  source?: string;
  is_addon?: boolean;
  group_id?: string | null;
  order_group?: OrderGroup | null;
}

const PICKING_LIST_SELECT = `
  id,
  order_number,
  status,
  items,
  updated_at,
  user_id,
  checked_by,
  profiles!user_id (full_name),
  checker_profile:profiles!checked_by (full_name),
  customer:customers(name),
  source,
  is_addon,
  group_id,
  order_group:order_groups(id, group_type)
`;

export const VERIFICATION_QUEUE_KEY = ['picking_lists', 'verification_queue'];
export const COMPLETED_ORDERS_KEY = ['picking_lists', 'completed_recent'];

export const useDoubleCheckList = () => {
  const queryClient = useQueryClient();

  const { data: rawOrders, isLoading: ordersLoading } = useQuery<PickingList[]>({
    queryKey: VERIFICATION_QUEUE_KEY,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('picking_lists')
        .select(PICKING_LIST_SELECT)
        .in('status', ['ready_to_double_check', 'double_checking', 'needs_correction'])
        .order('updated_at', { ascending: false });

      if (error) throw error;
      return ((data ?? []) as PickingList[]).filter(
        (o) => o.items && Array.isArray(o.items) && o.items.length > 0
      );
    },
    staleTime: 5_000,
    refetchOnWindowFocus: false,
  });

  const { data: completedOrders, isLoading: completedLoading } = useQuery<PickingList[]>({
    queryKey: COMPLETED_ORDERS_KEY,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('picking_lists')
        .select(PICKING_LIST_SELECT)
        .eq('status', 'completed')
        .order('updated_at', { ascending: false })
        .limit(6);

      if (error) throw error;
      return (data as PickingList[]) || [];
    },
    staleTime: 5_000,
    refetchOnWindowFocus: false,
  });

  // Realtime subscription — invalidate queries on changes
  useEffect(() => {
    const channel = supabase
      .channel('picking_lists_queue')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'picking_lists',
        },
        () => {
          queryClient.invalidateQueries({ queryKey: VERIFICATION_QUEUE_KEY });
          queryClient.invalidateQueries({ queryKey: COMPLETED_ORDERS_KEY });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [queryClient]);

  const orders = rawOrders ?? [];

  const { readyCount, correctionCount, checkingCount } = useMemo(
    () => ({
      readyCount: orders.filter((o) => o.status === 'ready_to_double_check').length,
      correctionCount: orders.filter((o) => o.status === 'needs_correction').length,
      checkingCount: orders.filter((o) => o.status === 'double_checking').length,
    }),
    [orders]
  );

  const refresh = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: VERIFICATION_QUEUE_KEY });
    queryClient.invalidateQueries({ queryKey: COMPLETED_ORDERS_KEY });
  }, [queryClient]);

  return {
    orders,
    completedOrders: completedOrders ?? [],
    readyCount,
    correctionCount,
    checkingCount,
    loading: ordersLoading || completedLoading,
    refresh,
  };
};
