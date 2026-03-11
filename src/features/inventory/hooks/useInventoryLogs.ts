import { useMemo, useCallback } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../../../lib/supabase';
import {
  type InventoryLog,
  type InventoryLogInput,
  InventoryLogSchema,
} from '../../../schemas/log.schema';
import { validateData } from '../../../utils/validate';
import { useAuth } from '../../../context/AuthContext';

interface UserInfo {
  performed_by?: string;
  user_id?: string;
}

/**
 * Hook to manage inventory logs and undo operations.
 * Implements sophisticated log coalescing and atomic undo logic.
 */
export const useInventoryLogs = () => {
  const queryClient = useQueryClient();
  const { isAdmin } = useAuth();
  /**
   * Records an activity in the inventory_logs table
   * Implements "Write-Time Coalescing": Updates the last log if specific conditions met.
   */
  /**
   * trackLogMutation
   * Wraps logging logic in a mutation for offline resilience and automatic retries.
   */
  const trackLogMutation = useMutation({
    mutationKey: ['inventory', 'trackLog'],
    networkMode: 'offlineFirst',
    // Infinite retry for network errors, immediate fail for logical errors
    retry: (failureCount, error: any) => {
      const code = error?.code || error?.originalError?.code;
      const message = error?.message || '';

      // Don't retry logical errors (auth, validation, ambiguity, etc)
      if (code === 'PGRST301' || code === '42501' || code === '23505' || code === '42725') return false;

      // Infinite retry for network errors
      if (message.includes('fetch') || message.includes('network') || !navigator.onLine) {
        return true;
      }

      // Default: retry up to 5 times for other errors
      return failureCount < 5;
    },
    retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 30000),
    mutationFn: async ({
      logData,
      userInfo = {},
      candidateLogId = null
    }: {
      logData: InventoryLogInput;
      userInfo?: UserInfo;
      candidateLogId?: string | null;
    }) => {
      // Defensive: Ensure we have the minimum data to attempt a log
      if (!logData || !logData.sku) {
        console.warn('[FORENSIC][DB][LOG_ABORT] Missing SKU or logData', logData);
        return null;
      }

      const { performed_by } = userInfo;
      const userName = performed_by || 'Warehouse Team';

      try {
        let targetLog: InventoryLog | null = null;

        // STRATEGY 1: Direct Chained Update (Optimistic)
        if (candidateLogId) {
          const { data: candidate } = await supabase
            .from('inventory_logs')
            .select('*')
            .eq('id', candidateLogId)
            .single();

          if (candidate) {
            const typedCandidate = candidate as unknown as InventoryLog;
            const isSameContext =
              !typedCandidate.is_reversed &&
              typedCandidate.sku === logData.sku &&
              (typedCandidate.from_location || null) === (logData.from_location || null) &&
              (typedCandidate.to_location || null) === (logData.to_location || null) &&
              (typedCandidate.order_number || null) === (logData.order_number || null);

            if (isSameContext) {
              targetLog = typedCandidate;
            }
          }
        }

        // STRATEGY 2: Fallback to Time-Based Search
        if (!targetLog) {
          // Safety: Only coalesce if we have a user_id to avoid collisions
          if (userInfo.user_id) {
            const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
            const { data: recentLogs } = await supabase
              .from('inventory_logs')
              .select('*')
              .eq('performed_by', userName)
              .eq('user_id', userInfo.user_id) // ✅ Ensure same user
              .gt('created_at', fiveMinutesAgo)
              .order('created_at', { ascending: false })
              .limit(1);

            const lastLog = recentLogs?.[0] as unknown as InventoryLog | undefined;

            if (
              lastLog &&
              lastLog.sku === logData.sku &&
              !lastLog.is_reversed &&
              (lastLog.from_location || null) === (logData.from_location || null) &&
              (lastLog.to_location || null) === (logData.to_location || null) &&
              (lastLog.to_warehouse || null) === (logData.to_warehouse || null) &&
              (lastLog.order_number || null) === (logData.order_number || null)
            ) {
              targetLog = lastLog;
            }
          }
        }

        // --- EXECUTE MERGE OR INSERT ---
        if (targetLog) {
          const sameType = targetLog.action_type === logData.action_type;
          const isInverse =
            (targetLog.action_type === 'ADD' && logData.action_type === 'DEDUCT') ||
            (targetLog.action_type === 'DEDUCT' && logData.action_type === 'ADD');

          if (sameType) {
            const newTotalChange = (targetLog.quantity_change || 0) + (logData.quantity_change || 0);

            console.log(
              `[FORENSIC][DB][LOG_MERGE] Status: SUCCESS - Action: ${logData.action_type}, Delta: ${targetLog.quantity_change} + ${logData.quantity_change} = ${newTotalChange}`
            );

            await supabase
              .from('inventory_logs')
              .update({
                quantity_change: newTotalChange,
                new_quantity: logData.new_quantity,
              })
              .eq('id', targetLog.id);

            return targetLog.id;
          } else if (isInverse) {
            const netChange = (targetLog.quantity_change || 0) + (logData.quantity_change || 0);

            if (netChange === 0) {
              console.log(`[FORENSIC][DB][LOG_CANCEL] Status: SUCCESS - SKU: ${logData.sku} - Net change is 0, deleting log.`);
              await supabase.from('inventory_logs').delete().eq('id', targetLog.id);
              return null;
            } else {
              console.log(`[FORENSIC][DB][LOG_INVERSE_MERGE] Status: SUCCESS - SKU: ${logData.sku} - Net change: ${netChange}`);
              await supabase
                .from('inventory_logs')
                .update({
                  quantity_change: netChange,
                  action_type: netChange > 0 ? targetLog.action_type : logData.action_type,
                  new_quantity: logData.new_quantity,
                })
                .eq('id', targetLog.id);
              return targetLog.id;
            }
          }
        }

        // --- INSERT NEW LOG (Default) ---
        console.log(`[FORENSIC][DB][INSERT_START] ${new Date().toISOString()} - SKU: ${logData.sku}`);
        const { data: newLog, error } = await supabase
          .from('inventory_logs')
          .insert([
            {
              ...logData,
              item_id: logData.item_id,
              prev_quantity: logData.prev_quantity ?? null,
              new_quantity: logData.new_quantity ?? null,
              is_reversed: logData.is_reversed || false,
              performed_by: userName,
              user_id: userInfo.user_id,
              created_at: new Date().toISOString(),
            } as any,
          ])
          .select()
          .single();

        if (error) {
          console.error(`[FORENSIC][DB][INSERT_ERROR] ${new Date().toISOString()}`, error);
          throw error;
        }

        const newId = (newLog as any)?.id;
        console.log(`[FORENSIC][DB][INSERT_SUCCESS] ${new Date().toISOString()} - New ID: ${newId}`);
        return newId;
      } catch (err) {
        console.error(`[FORENSIC][DB][TRACK_FAILED] ${new Date().toISOString()}`, err);
        throw err;
      }
    },
    onSuccess: (logId) => {
      if (logId) {
        queryClient.invalidateQueries({ queryKey: ['inventory_logs'] });
      }
    }
  });

  const trackLog = async (
    logData: InventoryLogInput,
    userInfo: UserInfo = {},
    candidateLogId: string | null = null
  ) => {
    return trackLogMutation.mutateAsync({ logData, userInfo, candidateLogId });
  };

  /**
   * Fetches the last 100 activity logs
   */
  const fetchLogs = useCallback(async (): Promise<InventoryLog[]> => {
    try {
      let query = supabase
        .from('inventory_logs')
        .select('*')
        .order('created_at', { ascending: false });

      if (!isAdmin) {
        query = query.neq('action_type', 'SYSTEM_RECONCILIATION');
      }

      const { data, error } = await query.limit(100);

      if (error) {
        console.error('Error fetching logs:', error);
        return [];
      }

      return (data || []).map((log) => validateData(InventoryLogSchema, log));
    } catch (err) {
      console.error('Fetch logs failed:', err);
      return [];
    }
  }, [isAdmin]);

  /**
   * Mutation for reversing a previously performed action using Database RPC
   */
  const undoMutation = useMutation({
    mutationKey: ['inventory', 'undo'],
    networkMode: 'offlineFirst',
    // Infinite retry for network errors to ensure undo completes
    retry: (failureCount, error: any) => {
      const code = error?.code || error?.originalError?.code;
      const message = error?.message || '';

      // Don't retry logical errors
      if (code === 'PGRST301' || code === '42501' || message.includes('cannot be undone')) {
        return false;
      }

      // Infinite retry for network errors
      if (message.includes('fetch') || message.includes('network') || !navigator.onLine) {
        return true;
      }

      // Default: retry up to 3 times
      return failureCount < 3;
    },
    retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 30000),
    mutationFn: async (logId: string) => {
      // Security Guard: Prevent undoing orders via API/RPC if UI is bypassed
      const { data: logInfo } = await supabase
        .from('inventory_logs')
        .select('order_number, list_id')
        .eq('id', logId)
        .single();

      if (logInfo?.order_number || logInfo?.list_id) {
        throw new Error('Actions associated with an order cannot be undone from the history.');
      }

      // @ts-ignore - RPC function added manually
      const { data, error } = await (supabase as any)
        .rpc('undo_inventory_action', { target_log_id: logId });

      if (error) throw error;

      const result = data as { success: boolean; message?: string };
      if (!result.success) {
        throw new Error(result.message || 'Undo operation failed');
      }
      return result;
    },
    onMutate: async (logId) => {
      console.log(`[FORENSIC][MUTATION][UNDO_START] ${new Date().toISOString()} - Target Log ID: ${logId}`);
      // Cancel refetches
      await queryClient.cancelQueries({ queryKey: ['inventory_logs'] });

      // Snapshot current logs
      const previousLogs = queryClient.getQueryData<InventoryLog[]>(['inventory_logs', 'TODAY']);

      // Optimistically update the UI: mark the log as reversed
      if (previousLogs) {
        queryClient.setQueryData(['inventory_logs', 'TODAY'], (old: any) => {
          return Array.isArray(old)
            ? old.map((l: any) => l.id === logId ? { ...l, is_reversed: true, isOptimistic: true } : l)
            : old;
        });
      }

      return { previousLogs };
    },
    onError: (err, logId, context: any) => {
      console.error(`[FORENSIC][MUTATION][UNDO_ERROR] ${new Date().toISOString()} - Log ID: ${logId}`, err);
      // Rollback on failure
      if (context?.previousLogs) {
        queryClient.setQueryData(['inventory_logs', 'TODAY'], context.previousLogs);
      }
    },
    onSuccess: (data, logId) => {
      console.log(`[FORENSIC][MUTATION][UNDO_SUCCESS] ${new Date().toISOString()} - Log ID: ${logId}`, data);
      // Invalidate both inventory and logs to get fresh data
      queryClient.invalidateQueries({ queryKey: ['inventory_logs'] });
      queryClient.invalidateQueries({ queryKey: ['inventory', 'lists'] });
    }
  });

  return useMemo(
    () => ({
      trackLog,
      fetchLogs,
      undoAction: undoMutation.mutateAsync,
      isUndoing: undoMutation.isPending,
      undoStatus: undoMutation.status,
    }),
    [trackLog, fetchLogs, undoMutation]
  );
};
