// idea-053: Long-Waiting Orders — mutation hooks for admin-only RPCs.
//
// Three RPCs: mark, unmark (resume|cancel), and take-over SKU.
// All gated by is_admin() in SQL. The UI should hide the buttons for
// non-admins as a UX courtesy, but the security boundary is the DB.
//
// On success, invalidates the picking-lists query key so the verification
// queue reflects the change immediately.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { supabase } from '../../../lib/supabase';

// ─── Mark as waiting ────────────────────────────────────────────────────────

interface MarkWaitingVars {
  listId: string;
  reason: string;
}

export function useMarkWaiting() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: ['waiting-orders', 'mark'],
    mutationFn: async (vars: MarkWaitingVars) => {
      const { error } = await supabase.rpc('mark_picking_list_waiting', {
        p_list_id: vars.listId,
        p_reason: vars.reason,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['picking-lists'] });
      toast.success('Order marked as waiting for inventory');
    },
    onError: (err) => {
      const message = err instanceof Error ? err.message : String(err);
      toast.error(`Could not mark as waiting: ${message}`);
    },
  });
}

// ─── Unmark (resume or cancel) ──────────────────────────────────────────────

interface UnmarkWaitingVars {
  listId: string;
  action: 'resume' | 'cancel';
}

export function useUnmarkWaiting() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: ['waiting-orders', 'unmark'],
    mutationFn: async (vars: UnmarkWaitingVars) => {
      const { error } = await supabase.rpc('unmark_picking_list_waiting', {
        p_list_id: vars.listId,
        p_action: vars.action,
      });
      if (error) throw error;
    },
    onSuccess: (_data, vars) => {
      queryClient.invalidateQueries({ queryKey: ['picking-lists'] });
      toast.success(
        vars.action === 'resume'
          ? 'Order resumed — back in verification queue'
          : 'Waiting order cancelled'
      );
    },
    onError: (err) => {
      const message = err instanceof Error ? err.message : String(err);
      toast.error(`Could not update waiting order: ${message}`);
    },
  });
}

// ─── Take over SKU from waiting order ───────────────────────────────────────

interface TakeOverSkuVars {
  waitingListId: string;
  targetListId: string;
  sku: string;
  qty: number;
}

export function useTakeOverSku() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: ['waiting-orders', 'take-over'],
    mutationFn: async (vars: TakeOverSkuVars) => {
      const { error } = await supabase.rpc('take_over_sku_from_waiting', {
        p_waiting_list_id: vars.waitingListId,
        p_target_list_id: vars.targetListId,
        p_sku: vars.sku,
        p_qty: vars.qty,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['picking-lists'] });
      toast.success('SKU taken over from waiting order');
    },
    onError: (err) => {
      const message = err instanceof Error ? err.message : String(err);
      toast.error(`Could not take over SKU: ${message}`);
    },
  });
}

// ─── Query: waiting orders count (for activity report + badge) ──────────────

export function useWaitingOrdersCount() {
  return useQuery({
    queryKey: ['waiting-orders', 'count'],
    queryFn: async (): Promise<number> => {
      const { count, error } = await supabase
        .from('picking_lists')
        .select('id', { count: 'exact', head: true })
        .eq('is_waiting_inventory', true);
      if (error) throw error;
      return count ?? 0;
    },
    staleTime: 60_000,
  });
}
