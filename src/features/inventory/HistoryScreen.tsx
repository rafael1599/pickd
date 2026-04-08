import { useState, useEffect, useMemo, useCallback } from 'react';
import { useQuery, useQueryClient, useMutationState } from '@tanstack/react-query';
import { supabase } from '../../lib/supabase';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { useDebounce } from '../../hooks/useDebounce';
import { useInventory } from './hooks/useInventoryData';
import type { InventoryItemInput, InventoryItemWithMetadata } from '../../schemas/inventory.schema';
import Clock from 'lucide-react/dist/esm/icons/clock';
import Undo2 from 'lucide-react/dist/esm/icons/undo-2';
import FileDown from 'lucide-react/dist/esm/icons/file-down';
import ArrowRight from 'lucide-react/dist/esm/icons/arrow-right';
import Plus from 'lucide-react/dist/esm/icons/plus';
import Minus from 'lucide-react/dist/esm/icons/minus';
import RotateCcw from 'lucide-react/dist/esm/icons/rotate-ccw';
import Trash2 from 'lucide-react/dist/esm/icons/trash-2';
import MoveIcon from 'lucide-react/dist/esm/icons/move';
import AlertCircle from 'lucide-react/dist/esm/icons/alert-circle';
import Calendar from 'lucide-react/dist/esm/icons/calendar';
import User from 'lucide-react/dist/esm/icons/user';
import Mail from 'lucide-react/dist/esm/icons/mail';
import Users from 'lucide-react/dist/esm/icons/users';
import Settings from 'lucide-react/dist/esm/icons/settings';
import Package from 'lucide-react/dist/esm/icons/package';
import { SearchInput } from '../../components/ui/SearchInput';
import { getUserColor, getUserBgColor } from '../../utils/userUtils';
import toast from 'react-hot-toast';
import { useAuth } from '../../context/AuthContext';
import { useError } from '../../context/ErrorContext';
import { useConfirmation } from '../../context/ConfirmationContext';
import { useViewMode } from '../../context/ViewModeContext';
import { useNavigate } from 'react-router-dom';

import type { InventoryLog, LogActionTypeValue } from '../../schemas/log.schema';

/** Snapshot shape used by PHYSICAL_DISTRIBUTION logs */
interface DistributionSnapshot {
  type?: string;
  change?: string;
  count?: number;
  units_each?: number;
}

/** Extended log with optimistic flag for pending mutations */
type OptimisticLog = InventoryLog & { isOptimistic: boolean };

/** Variables for updateQuantity mutation */
interface UpdateQuantityVars {
  sku: string;
  delta: number;
  finalDelta: number;
  warehouse: string;
  resolvedWarehouse: string;
  location: string | null;
  orderNumber?: string;
  optimistic_id?: string;
}

/** Variables for moveItem mutation */
interface MoveItemVars {
  sourceItem: InventoryItemWithMetadata;
  targetWarehouse: string;
  targetLocation: string;
  qty: number;
  optimistic_id?: string;
}

/** Variables for addItem mutation */
interface AddItemVars {
  warehouse: string;
  newItem: InventoryItemInput;
  optimistic_id?: string;
}

/** Variables for deleteItem mutation */
interface DeleteItemVars {
  sku: string;
  warehouse: string;
  location?: string | null;
  optimistic_id?: string;
}

/** Variables for updateItem mutation */
interface UpdateItemVars {
  originalItem: InventoryItemWithMetadata;
  updatedFormData: InventoryItemInput;
  optimistic_id?: string;
}

/** Union of all possible mutation variable shapes */
type MutationVariables =
  | UpdateQuantityVars
  | MoveItemVars
  | AddItemVars
  | DeleteItemVars
  | UpdateItemVars
  | string;

/** Action type info returned by getActionTypeInfo */
interface ActionTypeInfo {
  icon: React.ReactNode;
  color: string;
  bg: string;
  label: string;
  orderId?: string | null;
}

export const HistoryScreen = () => {
  const { isAdmin, profile, user: authUser } = useAuth();
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const { showError } = useError();
  const { showConfirmation } = useConfirmation();
  const { undoAction, inventoryData } = useInventory();
  const [manualLoading, setManualLoading] = useState(false);

  const queryClient = useQueryClient();
  const mutationCache = queryClient.getMutationCache();
  const [filter, setFilter] = useState<LogActionTypeValue | 'ALL'>('ALL');
  const [userFilter, setUserFilter] = useState('ALL');
  const [timeFilter, setTimeFilter] = useState('TODAY');
  const [searchQuery, setSearchQuery] = useState('');
  const [undoingId, setUndoingId] = useState<string | null>(null);
  const { isSearching, setExternalOrderId, setExternalShowPickingSummary } = useViewMode();
  const navigate = useNavigate();
  const debouncedSearch = useDebounce(searchQuery, 300);

  // Auto-scroll to top when searching to ensure results are visible
  useEffect(() => {
    if (searchQuery) {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }, [searchQuery]);

  const {
    data: logsData,
    isLoading: loading,
    error: queryError,
    refetch,
  } = useQuery({
    queryKey: ['inventory_logs', timeFilter],
    queryFn: async () => {
      let query = supabase
        .from('inventory_logs')
        .select('*') // Simplified: order_number is already in the table
        .order('created_at', { ascending: false });

      if (!isAdmin) {
        query = query.neq('action_type', 'SYSTEM_RECONCILIATION');
      }

      // Timezone-safe start of today in local time
      const startOfToday = new Date();
      startOfToday.setHours(0, 0, 0, 0);

      if (timeFilter === 'TODAY') {
        // We use the ISO string of the LOCAL midnight
        query = query.gte('created_at', startOfToday.toISOString());
      } else if (timeFilter === 'YESTERDAY') {
        const startOfYesterday = new Date(startOfToday);
        startOfYesterday.setDate(startOfYesterday.getDate() - 1);
        const endOfYesterday = new Date(startOfToday);
        endOfYesterday.setMilliseconds(-1);
        query = query
          .gte('created_at', startOfYesterday.toISOString())
          .lte('created_at', endOfYesterday.toISOString());
      } else if (timeFilter === 'WEEK') {
        const lastWeek = new Date(startOfToday);
        lastWeek.setDate(lastWeek.getDate() - 7);
        query = query.gte('created_at', lastWeek.toISOString());
      } else if (timeFilter === 'MONTH') {
        const lastMonth = new Date(startOfToday);
        lastMonth.setMonth(lastMonth.getMonth() - 1);
        query = query.gte('created_at', lastMonth.toISOString());
      } else {
        query = query.limit(300); // Increased limit for ALL
      }

      const { data, error } = await query;
      if (error) {
        console.error('History fetch error:', error);
        throw error;
      }

      return (data || []) as unknown as InventoryLog[];
    },
    staleTime: 1000 * 30, // 30 seconds
  });

  const getDisplayQty = useCallback((l: InventoryLog | null) => {
    if (!l) return 0;
    if (l.action_type === 'EDIT') return l.new_quantity ?? l.quantity_change ?? 0;
    if (l.action_type === 'PHYSICAL_DISTRIBUTION') {
      const snap = l.snapshot_before as DistributionSnapshot | null | undefined;
      return snap?.count && snap?.units_each ? snap.count * snap.units_each : (l.new_quantity ?? 0);
    }
    // For MOVE logs where quantity_change is 0 but it was actually a location rename, show the total quantity moved
    if (
      l.action_type === 'MOVE' &&
      (l.quantity_change === 0 || !l.quantity_change) &&
      l.new_quantity
    )
      return l.new_quantity;
    return Math.abs(l.quantity_change || 0);
  }, []);

  // --- OPTIMISTIC LOGS INJECTION (Hybrid Stream) ---
  // Use useMutationState to observe inventory mutations in a React-friendly way
  const pendingMutations = useMutationState({
    filters: {
      status: 'pending',
      predicate: (m) =>
        Array.isArray(m.options.mutationKey) && m.options.mutationKey[0] === 'inventory',
    },
    select: (mutation) => ({
      variables: mutation.state.variables as MutationVariables,
      status: mutation.state.status,
      isPaused: (mutation.state as unknown as Record<string, unknown>).isPaused as
        | boolean
        | undefined,
      mutationKey: mutation.options.mutationKey,
      submittedAt: mutation.state.submittedAt,
    }),
  });

  const optimisticLogs = useMemo(() => {
    return (pendingMutations || [])
      .filter((m) => {
        // Safety net: only show mutations submitted within the last 2 minutes
        const age = Date.now() - (m.submittedAt || 0);
        return age < 120_000;
      })
      .map((m) => {
        const vars = m.variables;
        const mutationKey = m.mutationKey;
        const mutationType = Array.isArray(mutationKey) ? mutationKey[1] : undefined;

        const optimisticId =
          typeof vars === 'object' && vars !== null && 'optimistic_id' in vars
            ? (vars as { optimistic_id?: string }).optimistic_id
            : undefined;

        // Base log template
        const log: Partial<InventoryLog> & { isOptimistic: boolean } = {
          id: optimisticId || `temp-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          created_at: new Date() as InventoryLog['created_at'],
          performed_by: profile?.full_name || authUser?.email || 'You',
          isOptimistic: true,
          is_reversed: false,
        };

        // Map specific mutation variables to Log format
        switch (mutationType) {
          case 'updateQuantity': {
            const v = vars as UpdateQuantityVars;
            log.sku = v.sku;
            log.action_type = v.finalDelta > 0 ? 'ADD' : 'DEDUCT';
            log.quantity_change = v.finalDelta;
            log.from_warehouse = v.finalDelta > 0 ? undefined : v.resolvedWarehouse;
            log.from_location = v.finalDelta > 0 ? undefined : v.location;
            log.to_warehouse = v.finalDelta > 0 ? v.resolvedWarehouse : undefined;
            log.to_location = v.finalDelta > 0 ? v.location : undefined;
            log.order_number = v.orderNumber;
            break;
          }

          case 'moveItem': {
            const v = vars as MoveItemVars;
            log.sku = v.sourceItem?.sku;
            log.action_type = 'MOVE';
            log.quantity_change = -v.qty; // Log the movement magnitude
            log.from_warehouse = v.sourceItem?.warehouse;
            log.from_location = v.sourceItem?.location;
            log.to_warehouse = v.targetWarehouse;
            log.to_location = v.targetLocation;
            break;
          }

          case 'addItem': {
            const v = vars as AddItemVars;
            log.sku = v.newItem?.sku;
            log.action_type = 'ADD';
            log.quantity_change = v.newItem?.quantity;
            log.to_warehouse = v.warehouse;
            log.to_location = v.newItem?.location;
            break;
          }

          case 'deleteItem': {
            const v = vars as DeleteItemVars;
            log.sku = v.sku;
            log.action_type = 'DELETE';
            log.from_warehouse = v.warehouse;
            break;
          }

          case 'updateItem': {
            const v = vars as UpdateItemVars;
            log.sku = v.updatedFormData?.sku;
            log.action_type = 'EDIT';
            log.previous_sku =
              v.originalItem?.sku !== v.updatedFormData?.sku ? v.originalItem?.sku : undefined;
            break;
          }

          case 'undo':
            // The mutation variable for 'undo' is the logId string
            log.id = vars as string;
            log.action_type = 'UNDO' as LogActionTypeValue;
            break;
        }

        return log as OptimisticLog;
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mutationCache reference is stable but its internal state changes trigger re-renders via pendingMutations
  }, [mutationCache, profile, authUser]);

  // Combine real and optimistic logs with defensive handling
  const logs = useMemo(() => {
    const serverLogs = logsData || [];

    // Defensive: If we're offline and have no cached data, only show optimistic logs
    if (!logsData && optimisticLogs.length > 0) {
      return optimisticLogs;
    }

    // Normal case: merge and deduplicate
    const seenIds = new Set<string>();
    const combined: OptimisticLog[] = [];

    // Process all logs
    [...optimisticLogs, ...serverLogs].forEach((l) => {
      // Deduplicate by ID but keep optimistic flags
      if (!l.id || seenIds.has(l.id)) return;
      seenIds.add(l.id);
      combined.push({
        ...l,
        isOptimistic: 'isOptimistic' in l ? !!(l as OptimisticLog).isOptimistic : false,
      });
    });

    // Special handling for undo: if we have a pending undo mutation,
    // mark the targeted log as reversed/optimistic in the UI
    const pendingUndoIds = optimisticLogs
      .filter((m) => m.action_type === ('UNDO' as LogActionTypeValue))
      .map((m) => m.id);

    const finalLogs = combined.map((l) => {
      if (pendingUndoIds.includes(l.id)) {
        return { ...l, is_reversed: true, isOptimistic: true };
      }
      return l;
    });

    // Safe sort with fallback
    return finalLogs.sort((a, b) => {
      const dateA = a?.created_at ? new Date(a.created_at).getTime() : 0;
      const dateB = b?.created_at ? new Date(b.created_at).getTime() : 0;
      return dateB - dateA;
    });
  }, [logsData, optimisticLogs]);

  const hasNoData = !loading && logs.length === 0;

  const fetchLogs = useCallback(() => {
    console.log(`[FORENSIC][CACHE][REFETCH_TRIGGER] ${new Date().toISOString()}`);
    refetch();
  }, [refetch]);

  // Network & Cache Monitoring
  useEffect(() => {
    const handleOnline = () => {
      console.log(`[FORENSIC][NETWORK] ${new Date().toISOString()} - ONLINE detected`);
      setIsOnline(true);
    };
    const handleOffline = () => {
      console.log(`[FORENSIC][NETWORK] ${new Date().toISOString()} - OFFLINE detected`);
      setIsOnline(false);
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  useEffect(() => {
    if (logsData) {
      console.log(
        `[FORENSIC][CACHE][LOGS_UPDATE] ${new Date().toISOString()} - Size: ${logsData.length}`
      );
    }
  }, [logsData]);

  const error = queryError ? queryError.message : null;

  useEffect(() => {
    let channel: RealtimeChannel | null = null;
    let retryTimeout: ReturnType<typeof setTimeout> | null = null;
    let retryCount = 0;
    let isMounted = true;
    const MAX_RETRIES = 10;

    const setupSubscription = () => {
      if (!isMounted) return;

      // Ensure any previous zombie channel is cleaned
      if (channel) {
        supabase.removeChannel(channel);
        channel = null;
      }

      console.log(
        `[FORENSIC][REALTIME][LOGS_INIT] ${new Date().toISOString()} - Setting up channel log_updates (Attempt ${retryCount + 1}/${MAX_RETRIES})`
      );

      channel = supabase
        .channel('log_updates')
        .on(
          'postgres_changes',
          { event: 'INSERT', schema: 'public', table: 'inventory_logs' },
          (payload) => {
            if (!isMounted) return;
            console.log(
              `[FORENSIC][REALTIME][LOGS_EVENT] ${new Date().toISOString()} - INSERT, SKU: ${payload.new?.sku}`
            );
            queryClient.invalidateQueries({ queryKey: ['inventory_logs'] });
          }
        )
        .on(
          'postgres_changes',
          { event: 'UPDATE', schema: 'public', table: 'inventory_logs' },
          (payload) => {
            if (!isMounted) return;
            console.log(
              `[FORENSIC][REALTIME][LOGS_EVENT] ${new Date().toISOString()} - UPDATE, SKU: ${payload.new?.sku}`
            );
            queryClient.invalidateQueries({ queryKey: ['inventory_logs'] });
          }
        )
        .on(
          'postgres_changes',
          { event: 'DELETE', schema: 'public', table: 'inventory_logs' },
          (payload) => {
            if (!isMounted) return;
            console.log(
              `[FORENSIC][REALTIME][LOGS_EVENT] ${new Date().toISOString()} - DELETE, ID: ${payload.old?.id}`
            );
            queryClient.invalidateQueries({ queryKey: ['inventory_logs'] });
          }
        )
        .subscribe((status, err) => {
          if (!isMounted) return;

          console.log(
            `[FORENSIC][REALTIME][LOGS_STATUS] ${new Date().toISOString()} - Status: ${status}`
          );

          if (err) {
            console.error(`[FORENSIC][REALTIME][LOGS_ERROR] ${new Date().toISOString()}`, err);
          }

          if (status === 'SUBSCRIBED') {
            retryCount = 0; // Reset on success
          }

          // Handle disconnection/errors
          if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
            // Only retry if the component is still mounted and it wasn't an intentional closure
            if (isMounted && status !== 'CLOSED') {
              if (retryCount < MAX_RETRIES) {
                retryCount++;
                const backoff = Math.min(2000 * Math.pow(1.5, retryCount), 30000); // Max 30s backoff
                console.warn(
                  `[FORENSIC][REALTIME][LOGS_RETRY] ${new Date().toISOString()} - Channel ${status}, retrying in ${Math.round(backoff / 1000)}s...`
                );
                if (retryTimeout) clearTimeout(retryTimeout);
                retryTimeout = setTimeout(setupSubscription, backoff);
              } else {
                console.error(
                  `[FORENSIC][REALTIME][LOGS_FATAL] ${new Date().toISOString()} - Max retries reached.`
                );
                toast.error('Real-time logs disconnected. Please refresh if this persists.', {
                  id: 'realtime-logs-error',
                });
              }
            }
          }
        });
    };

    setupSubscription();

    return () => {
      isMounted = false;
      console.log(`[FORENSIC][REALTIME][LOGS_CLEANUP] ${new Date().toISOString()}`);
      if (retryTimeout) clearTimeout(retryTimeout);
      if (channel) {
        supabase.removeChannel(channel);
      }
    };
  }, [queryClient]);

  const uniqueUsers = useMemo(() => {
    const users = new Set(logs.map((log) => log.performed_by).filter(Boolean));
    return Array.from(users).sort();
  }, [logs]);

  const filteredLogs = useMemo(() => {
    return logs
      .filter((log) => filter === 'ALL' || log.action_type === filter)
      .filter((log) => userFilter === 'ALL' || log.performed_by === userFilter)
      .filter(() => {
        // Show reversed logs to everyone now that everyone can undo
        return true;
      })
      .filter((log) => {
        const query = debouncedSearch.toLowerCase();
        return (
          !debouncedSearch ||
          log.sku?.toLowerCase().includes(query) ||
          log.from_location?.toLowerCase().includes(query) ||
          log.to_location?.toLowerCase().includes(query) ||
          log.order_number?.toLowerCase().includes(query) ||
          (log.list_id && log.list_id.toLowerCase().includes(query))
        );
      });
  }, [logs, filter, userFilter, debouncedSearch]);

  const groupedLogs = useMemo(() => {
    const groups: Record<string, OptimisticLog[]> = {};
    filteredLogs.forEach((log) => {
      const date = new Date(log.created_at);
      const today = new Date();
      const yesterday = new Date();
      yesterday.setDate(today.getDate() - 1);

      let dateLabel;
      if (date.toDateString() === today.toDateString()) dateLabel = 'Today';
      else if (date.toDateString() === yesterday.toDateString()) dateLabel = 'Yesterday';
      else
        dateLabel = date.toLocaleDateString(undefined, {
          weekday: 'long',
          month: 'short',
          day: 'numeric',
        });

      if (!groups[dateLabel]) groups[dateLabel] = [];
      groups[dateLabel].push(log);
    });
    return groups;
  }, [filteredLogs]);

  const latestLogIdsPerItem = useMemo(() => {
    const latestIds = new Set<string>();
    const seenItems = new Set<string>();

    // logs is already sorted DESC (newest first)
    logs.forEach((log) => {
      // We only care about non-reversed logs for LIFO candidates
      // and we only consider "Actionable" logs (not systems/recon)
      if (log.is_reversed || log.action_type === 'SYSTEM_RECONCILIATION') return;

      const itemKey = log.item_id
        ? `ID-${log.item_id}`
        : `SKU-${log.sku}-${log.from_warehouse}-${log.from_location || log.to_location}`;

      if (!seenItems.has(itemKey)) {
        latestIds.add(log.id);
        seenItems.add(itemKey);
      }
    });

    return latestIds;
  }, [logs]);

  const checkIsStaleRevival = useCallback(
    (log: InventoryLog) => {
      if (!log.created_at) return false;

      // 1. Check age (> 48h)
      const logDate = new Date(log.created_at).getTime();
      const now = new Date().getTime();
      const ageInHours = (now - logDate) / (1000 * 60 * 60);
      const isOld = ageInHours > 48;

      if (!isOld) return false;

      // 2. Check if item exists in inventoryData
      // We look for the item at the location it was supposed to be in
      const targetWarehouse = log.to_warehouse || log.from_warehouse;
      const targetLocation = log.to_location || log.from_location;

      const exists = (inventoryData || []).some(
        (item) =>
          item.sku === log.sku &&
          item.warehouse === targetWarehouse &&
          (item.location || '').toUpperCase() === (targetLocation || '').toUpperCase()
      );

      // If it's old AND the record is missing from inventory, it's a "Revival"
      // Note: If it's old but the record IS there, it's just a quantity change (allowed)
      return !exists;
    },
    [inventoryData]
  );

  const handleUndo = useCallback(
    async (id: string) => {
      if (undoingId) return;

      const log = logs.find((l) => l.id === id);
      if (log && checkIsStaleRevival(log)) {
        toast.error('Records over 48h old cannot be revived. Please restock this SKU manually.', {
          duration: 5000,
          icon: '⚠️',
        });
        return;
      }

      showConfirmation(
        'Undo Action',
        'Are you sure you want to undo this action?',
        async () => {
          try {
            setUndoingId(id);
            // Non-blocking call to support offline queueing
            await undoAction(id);
            // Implicit feedback via optimistic UI (badge)
          } catch (err: unknown) {
            // Check if it's a network error (meant to be queued)
            const errMsg = err instanceof Error ? err.message : String(err);
            const isOffline =
              !navigator.onLine || errMsg.includes('fetch') || errMsg.includes('disconnected');

            if (!isOffline) {
              console.error('Undo failed:', err);
              toast.error(`Error: ${errMsg}`);
              await fetchLogs();
            }
          } finally {
            setUndoingId(null);
          }
        },
        () => setUndoingId(null),
        'Undo'
      );
    },
    [undoAction, fetchLogs, showConfirmation, undoingId, logs, checkIsStaleRevival]
  );

  const getActionTypeInfo = (type: LogActionTypeValue, log: InventoryLog): ActionTypeInfo => {
    switch (type) {
      case 'MOVE':
        return {
          icon: <MoveIcon size={14} />,
          color: 'text-blue-500',
          bg: 'bg-blue-500/10',
          label: 'Relocate',
        };
      case 'ADD':
        return {
          icon: <Plus size={14} />,
          color: 'text-green-500',
          bg: 'bg-green-500/10',
          label: 'Restock',
        };
      case 'DEDUCT': {
        const orderLabel = log.order_number
          ? `ORDER #${log.order_number}`
          : log.list_id
            ? `ORDER #${log.list_id.slice(-6).toUpperCase()}`
            : 'Manual Pick';
        const hasOrder = !!(log.list_id || log.order_number);
        return {
          icon: <Minus size={14} />,
          color: 'text-red-500',
          bg: 'bg-red-500/10',
          label: orderLabel,
          orderId: hasOrder ? log.list_id : null,
        };
      }
      case 'DELETE':
        return {
          icon: <Trash2 size={14} />,
          color: 'text-muted',
          bg: 'bg-surface',
          label: 'Remove',
        };
      case 'EDIT':
        return {
          icon: <Clock size={14} />,
          color: 'text-blue-500',
          bg: 'bg-blue-500/10',
          label: 'Update',
        };
      case 'PHYSICAL_DISTRIBUTION': {
        const snap = log.snapshot_before as DistributionSnapshot | null | undefined;
        const distLabel = snap?.type
          ? `${snap.change === 'removed' ? '- ' : '+ '}${snap.count} ${snap.type} × ${snap.units_each}u`
          : 'Distribution';
        return {
          icon: <Package size={14} />,
          color: 'text-orange-500',
          bg: 'bg-orange-500/10',
          label: distLabel,
        };
      }
      case 'SYSTEM_RECONCILIATION':
        return {
          icon: <Settings size={14} />,
          color: 'text-purple-500',
          bg: 'bg-purple-500/10',
          label: 'System Sync (Recon)',
        };
      default:
        return {
          icon: <Clock size={14} />,
          color: 'text-muted',
          bg: 'bg-surface',
          label: (type as string) || 'Update',
        };
    }
  };

  const generateDailyPDF = useCallback(
    (
      jsPDFInstance: typeof import('jspdf').default,
      autoTableInstance: typeof import('jspdf-autotable').default
    ) => {
      const doc = new jsPDFInstance({
        orientation: 'landscape',
        unit: 'mm',
        format: 'a4',
      });
      const today = new Date().toLocaleDateString('es-ES');
      const generatorName = profile?.full_name || authUser?.email || 'System';
      const firstName = generatorName.split(' ')[0];

      let title = 'History Report';
      if (filter !== 'ALL') {
        const labels: Record<string, string> = {
          MOVE: 'Movement',
          ADD: 'Restock',
          DEDUCT: 'Picking',
          DELETE: 'Removal',
          SYSTEM_RECONCILIATION: 'Reconciliation',
        };
        title = `${labels[filter] || filter} Report`;
      }

      if (userFilter !== 'ALL') {
        title += ` (${userFilter})`;
      }

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(32);
      doc.text(title, 5, 15);

      const stats = {
        total: filteredLogs.length,
        qty: filteredLogs.reduce((acc, l) => acc + Number(getDisplayQty(l)), 0),
      };

      const metadataLine = `By: ${firstName} | Date: ${today} | Logs: ${stats.total} | Qty: ${stats.qty} | Period: ${timeFilter}`;

      let currentY = 32;
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(28);
      doc.text('Time | SKU | Activity Detail | Qty', 5, currentY);
      currentY += 8;

      const tableData = filteredLogs.map((log) => {
        let description = '';
        const fromLoc = log.from_location || '';
        const toLoc = log.to_location || '';
        const performer = log.performed_by || 'Unknown';
        const pFirstName = performer.split(' ')[0];

        const whInfo =
          log.from_warehouse && log.to_warehouse && log.from_warehouse !== log.to_warehouse
            ? ` [${log.from_warehouse}->${log.to_warehouse}]`
            : log.from_warehouse
              ? ` [${log.from_warehouse}]`
              : '';

        let actionTag = '';
        switch (log.action_type) {
          case 'MOVE':
            actionTag = '[MOVE]';
            break;
          case 'ADD':
            actionTag = '[ADD]';
            break;
          case 'DEDUCT':
            actionTag = '[PICK]';
            break;
          case 'DELETE':
            actionTag = '[DEL]';
            break;
          case 'SYSTEM_RECONCILIATION':
            actionTag = '[SYS]';
            break;
          default:
            actionTag = `[${log.action_type}]`;
        }

        switch (log.action_type) {
          case 'MOVE':
            description = `${actionTag} ${pFirstName}: ${fromLoc} -> ${toLoc}${whInfo}`;
            break;
          case 'ADD':
            description = `${actionTag} ${pFirstName}: Stocked @ ${toLoc || fromLoc || 'Gen'}`;
            break;
          case 'DEDUCT':
            description = `${actionTag} ${pFirstName}: Picked @ ${fromLoc || 'Gen'}`;
            break;
          case 'DELETE':
            description = `${actionTag} ${pFirstName}: Removed @ ${fromLoc || 'Inv'}`;
            break;
          case 'SYSTEM_RECONCILIATION':
            description = `${actionTag} Reconciliation Audit`;
            break;
          default:
            description = `${actionTag} ${pFirstName}: Update @ ${fromLoc || toLoc || '-'}`;
        }

        if (log.is_reversed) {
          description += ' (REVERSED)';
        }

        return [
          new Date(log.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          log.sku,
          description,
          getDisplayQty(log).toString(),
        ];
      });

      autoTableInstance(doc, {
        startY: currentY,
        body: tableData,
        theme: 'plain',
        styles: {
          fontSize: 40,
          cellPadding: 6,
          minCellHeight: 20,
          textColor: [0, 0, 0],
          lineColor: [0, 0, 0],
          lineWidth: 1.1,
          font: 'helvetica',
          valign: 'middle',
        },
        columnStyles: {
          0: { cellWidth: 40, fontSize: 26, halign: 'center' },
          1: { cellWidth: 90, fontStyle: 'bold', fontSize: 40, halign: 'left' },
          2: { cellWidth: 'auto', fontSize: 22, halign: 'left' },
          3: { cellWidth: 35, fontSize: 40, halign: 'right', fontStyle: 'bold' },
        },
        margin: { top: 5, right: 5, bottom: 5, left: 5 },
        didDrawPage: () => {
          doc.setFont('helvetica', 'normal');
          doc.setFontSize(14);
          doc.text(metadataLine, 292, 205, { align: 'right' });
        },
      });

      return doc;
    },
    [filteredLogs, filter, userFilter, timeFilter, profile, authUser, getDisplayQty]
  );

  const handleDownloadReport = useCallback(async () => {
    try {
      setManualLoading(true);
      const [{ default: jsPDF }, { default: autoTable }] = await Promise.all([
        import('jspdf'),
        import('jspdf-autotable'),
      ]);
      const doc = generateDailyPDF(jsPDF, autoTable);
      const blob = doc.output('bloburl');
      window.open(blob, '_blank');
      toast.success('History report opened in new tab');
    } catch (err: unknown) {
      console.error('Failed to generate PDF:', err);
      showError('Error generating PDF report.', err instanceof Error ? err.message : String(err));
    } finally {
      setManualLoading(false);
    }
  }, [generateDailyPDF, showError]);

  const sendDailyEmail = useCallback(async () => {
    try {
      console.log('Attempting to send daily email...');

      const now = new Date();
      const todayStr = now.toLocaleDateString();
      const todayStrComp = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

      const todaysLogs = logs.filter((log) => {
        if (!log.created_at) return false;
        if (log.is_reversed) return false;

        const logDate = new Date(log.created_at);
        const logDateStr = `${logDate.getFullYear()}-${String(logDate.getMonth() + 1).padStart(2, '0')}-${String(logDate.getDate()).padStart(2, '0')}`;
        return logDateStr === todayStrComp;
      });

      const moveCount = todaysLogs.filter((l) => l.action_type === 'MOVE').length;
      const pickCount = todaysLogs.filter((l) => l.action_type === 'DEDUCT').length;
      const addCount = todaysLogs.filter((l) => l.action_type === 'ADD').length;

      const htmlContent = `
                <h1>Daily Inventory Summary - ${todayStr}</h1>
                <p><strong>Total Actions:</strong> ${todaysLogs.length}</p>
                <ul>
                    <li>Moves: ${moveCount}</li>
                    <li>Picks: ${pickCount}</li>
                    <li>Restocks: ${addCount}</li>
                </ul>
                
                <h2>Activity Details</h2>
                <table style="width: 100%; border-collapse: collapse; text-align: left; font-family: sans-serif;">
                    <thead>
                        <tr style="background-color: #f3f4f6; color: #374151;">
                            <th style="padding: 12px; border-bottom: 2px solid #e5e7eb; width: 80px;">Time</th>
                            <th style="padding: 12px; border-bottom: 2px solid #e5e7eb; width: 120px;">SKU</th>
                            <th style="padding: 12px; border-bottom: 2px solid #e5e7eb;">Activity Description</th>
                            <th style="padding: 12px; border-bottom: 2px solid #e5e7eb; text-align: right; width: 60px;">Qty</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${todaysLogs
                          .map((log) => {
                            const locationStyle = 'font-weight: 600; color: #111827;';
                            const secondaryColor = '#6b7280';

                            const fromLoc = log.from_location
                              ? `<span style="${locationStyle}">${log.from_location}</span> <span style="color:${secondaryColor}; font-size: 0.8em;">(${log.from_warehouse || 'N/A'})</span>`
                              : '';
                            const toLoc = log.to_location
                              ? `<span style="${locationStyle}">${log.to_location}</span> <span style="color:${secondaryColor}; font-size: 0.8em;">(${log.to_warehouse || 'N/A'})</span>`
                              : '';

                            let description = '';
                            switch (log.action_type) {
                              case 'MOVE':
                                description = `Relocated from ${fromLoc} to ${toLoc}`;
                                break;
                              case 'ADD':
                                description = `Restocked inventory in ${toLoc || fromLoc || 'General'}`;
                                break;
                              case 'DEDUCT':
                                description = `Picked stock from ${fromLoc || 'General'}`;
                                break;
                              case 'DELETE':
                                description = `Removed item from ${fromLoc || 'Inventory'}`;
                                break;
                              case 'SYSTEM_RECONCILIATION':
                                description = `System reconciliation audit`;
                                break;
                              default:
                                description = `Updated record for ${fromLoc || toLoc || '-'}`;
                            }

                            return `
                                <tr style="border-bottom: 1px solid #f3f4f6;">
                                    <td style="padding: 12px; color: #6b7280; font-size: 0.9em;">
                                        ${new Date(log.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                    </td>
                                    <td style="padding: 12px; font-weight: bold; color: #111827;">
                                        ${log.sku}
                                    </td>
                                    <td style="padding: 12px; color: #374151;">
                                        ${description}
                                    </td>
                                    <td style="padding: 12px; text-align: right; font-weight: bold;">
                                        ${(() => {
                                          if (log.action_type === 'EDIT')
                                            return log.new_quantity ?? log.quantity_change ?? 0;
                                          if (log.action_type === 'PHYSICAL_DISTRIBUTION') {
                                            const s = log.snapshot_before as
                                              | DistributionSnapshot
                                              | null
                                              | undefined;
                                            return s?.count && s?.units_each
                                              ? s.count * s.units_each
                                              : (log.new_quantity ?? 0);
                                          }
                                          if (
                                            log.action_type === 'MOVE' &&
                                            (log.quantity_change === 0 || !log.quantity_change) &&
                                            log.new_quantity
                                          )
                                            return log.new_quantity;
                                          return Math.abs(log.quantity_change || 0);
                                        })()}
                                    </td>
                                </tr>
                            `;
                          })
                          .join('')}
                    </tbody>
                </table>
                
                <p style="margin-top: 30px; font-size: 11px; color: #9ca3af; text-align: center;">
                    Automated report generated by PickD • ${new Date().toLocaleString()}
                </p>
            `;

      const { data, error } = await supabase.functions.invoke('send-daily-report', {
        body: {
          to: 'rafaelukf@gmail.com',
          subject: `Daily Inventory Report - ${todayStr}`,
          html: htmlContent,
        },
      });

      if (error) {
        console.error('Edge Function Invocation Error:', error);
        throw error;
      }

      if (data?.error) {
        console.error('Email Sending Error:', data.error);
        showError('Error sending email', JSON.stringify(data.error));
        return;
      }

      console.log('Email sent successfully:', data);
      localStorage.setItem(`email_sent_${new Date().toDateString()}`, 'true');
      toast.success(`Daily report sent to rafaelukf@gmail.com`);
    } catch (err: unknown) {
      console.error('Failed to send email:', err);
      showError(
        'Failed to send daily email',
        err instanceof Error ? err.message : 'Failed to send daily email via Edge Function.'
      );
    }
  }, [logs, showError]);

  return (
    <div className="pb-32 relative max-w-2xl mx-auto w-full px-4">
      {!isSearching && (
        <header className="flex justify-between items-end mb-8 pt-6">
          <div>
            <h1 className="text-5xl font-black uppercase tracking-tighter leading-none">History</h1>
            <p className="text-muted text-[10px] font-black uppercase tracking-[0.3em] mt-2 flex items-center gap-2">
              <Clock size={10} /> Live Activity Log
            </p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={fetchLogs}
              className="p-3 bg-surface border border-subtle rounded-2xl hover:opacity-80 transition-all text-content"
              title="Refresh Logs"
            >
              <RotateCcw className={loading || manualLoading ? 'animate-spin' : ''} size={20} />
            </button>
          </div>
        </header>
      )}

      {/* Search and Filters */}
      <div className="space-y-4 mb-8">
        <SearchInput
          value={searchQuery}
          onChange={setSearchQuery}
          placeholder="Search SKU or Location..."
          preferenceId="history"
        />

        {!isSearching && (
          <>
            <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-hide">
              {['ALL', 'MOVE', 'ADD', 'DEDUCT', 'DELETE', 'PHYSICAL_DISTRIBUTION'].map((f) => (
                <button
                  key={f}
                  onClick={() => setFilter(f as LogActionTypeValue | 'ALL')}
                  className={`px-5 py-2.5 rounded-full text-[10px] font-black uppercase tracking-widest transition-all border shrink-0 ${
                    filter === f
                      ? 'bg-accent border-accent/20 text-main shadow-lg shadow-accent/20'
                      : 'bg-surface text-muted border-subtle hover:border-muted/30'
                  }`}
                >
                  {f === 'DEDUCT' ? 'Picking' : f === 'PHYSICAL_DISTRIBUTION' ? 'Distribution' : f}
                </button>
              ))}
            </div>

            {/* User Filters */}
            <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-hide items-center">
              <div className="shrink-0 p-2 bg-surface/50 rounded-full border border-subtle">
                <Users size={14} className="text-muted" />
              </div>
              <button
                onClick={() => setUserFilter('ALL')}
                className={`px-4 py-2 rounded-full text-[10px] font-black uppercase tracking-widest transition-all border shrink-0 ${
                  userFilter === 'ALL'
                    ? 'bg-content text-main border-content shadow-lg'
                    : 'bg-surface text-muted border-subtle hover:border-muted/30'
                }`}
              >
                All Users
              </button>
              {uniqueUsers.map((user) => (
                <button
                  key={user}
                  onClick={() => setUserFilter(user)}
                  style={{
                    borderColor: userFilter === user ? getUserColor(user) : undefined,
                    color: userFilter === user ? 'white' : getUserColor(user),
                    backgroundColor:
                      userFilter === user ? getUserColor(user) : getUserBgColor(user),
                  }}
                  className={`px-4 py-2 rounded-full text-[10px] font-bold transition-all border shrink-0 flex items-center gap-2 ${userFilter === user ? 'shadow-lg' : 'hover:border-muted/30'}`}
                >
                  <User size={10} />
                  {user}
                </button>
              ))}
            </div>

            {/* Time Filters */}
            <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-hide items-center">
              <div className="shrink-0 p-2 bg-surface/50 rounded-full border border-subtle">
                <Clock size={14} className="text-muted" />
              </div>
              {['TODAY', 'YESTERDAY', 'WEEK', 'MONTH', 'ALL'].map((tf) => (
                <button
                  key={tf}
                  onClick={() => setTimeFilter(tf)}
                  className={`px-4 py-2 rounded-full text-[10px] font-black uppercase tracking-widest transition-all border shrink-0 ${
                    timeFilter === tf
                      ? 'bg-accent border-accent/20 text-main shadow-lg shadow-accent/20'
                      : 'bg-surface text-muted border-subtle hover:border-muted/30'
                  }`}
                >
                  {tf.toLowerCase()}
                </button>
              ))}
            </div>
          </>
        )}
      </div>

      {/* Logs List */}
      <div className="space-y-8">
        {loading && logs.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 gap-3 opacity-30">
            <RotateCcw className="animate-spin" size={32} />
            <span className="text-[10px] font-black uppercase tracking-widest">
              Scanning blockchain...
            </span>
          </div>
        ) : error ? (
          <div className="p-8 bg-red-500/5 border border-red-500/20 rounded-3xl text-center">
            <AlertCircle className="mx-auto mb-3 text-red-500" size={32} />
            <p className="text-sm font-bold text-red-400 mb-1">Database Error</p>
            <p className="text-[10px] text-red-500/60 font-mono uppercase truncate">{error}</p>
            <button
              onClick={fetchLogs}
              className="mt-4 text-xs font-black uppercase text-red-500 hover:underline"
            >
              Retry Connection
            </button>
          </div>
        ) : hasNoData ? (
          <div className="text-center py-24 border-2 border-dashed border-subtle rounded-[2.5rem]">
            <AlertCircle className="mx-auto mb-4 opacity-20" size={48} />
            <p className="text-xs font-black uppercase tracking-[0.2em] text-muted mb-2">
              No history available
            </p>
            {!isOnline && (
              <p className="text-[10px] text-muted/60 font-medium italic">
                Connect to internet to load history
              </p>
            )}
          </div>
        ) : filteredLogs.length === 0 ? (
          <div className="text-center py-24 border-2 border-dashed border-subtle rounded-[2.5rem]">
            <Clock className="mx-auto mb-4 opacity-10" size={48} />
            <p className="text-xs font-black uppercase tracking-[0.2em] text-muted">
              No matching activities
            </p>
          </div>
        ) : (
          Object.entries(groupedLogs).map(([date, items]) => (
            <div key={date} className="space-y-4">
              <h3 className="sticky top-0 z-10 py-4 -mx-4 px-6 bg-main/90 backdrop-blur-md border-b border-subtle text-[10px] font-black uppercase tracking-[0.3em] text-muted flex items-center gap-2">
                <Calendar size={12} className="text-accent" /> {date}
              </h3>
              <div className="space-y-3 px-1">
                {items.map((log) => {
                  const info = getActionTypeInfo(log.action_type, log);
                  return (
                    <div
                      key={log.id}
                      style={{
                        animationDelay: `${(items.indexOf(log) % 15) * 0.03}s`,
                        zIndex: items.length - items.indexOf(log),
                      }}
                      className={`group relative p-6 ios-squircle border animate-staggered-fade-in ${
                        log.is_reversed || log.isOptimistic
                          ? 'bg-main/40 border-subtle'
                          : 'bg-card border-subtle hover:border-accent/30 hover:shadow-lg'
                      } ${
                        log.isOptimistic ? 'opacity-60 border-dashed' : ''
                      } ${log.is_reversed ? 'opacity-40 grayscale' : ''}`}
                    >
                      <div className="flex justify-between items-start">
                        <div className="flex items-center gap-4">
                          <div className={`p-3 rounded-2xl ${info.bg} ${info.color} shadow-inner`}>
                            {info.icon}
                          </div>
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="text-lg font-black tracking-tighter uppercase text-content">
                                {log.sku}
                              </span>
                              <span
                                className={`text-[10px] font-black px-2 py-1 rounded-none border ${info.bg} ${info.color} border-current/20 ${info.orderId ? 'cursor-pointer hover:underline hover:brightness-125 active:scale-95 transition-all' : ''}`}
                                onClick={
                                  info.orderId
                                    ? (e: React.MouseEvent) => {
                                        e.stopPropagation();
                                        setExternalOrderId(info.orderId ?? null);
                                        setExternalShowPickingSummary(true);
                                        navigate('/orders');
                                      }
                                    : undefined
                                }
                              >
                                {info.label}
                              </span>
                              {log.isOptimistic && (
                                <span className="text-[8px] font-black bg-accent/20 text-accent px-2 py-1 flex items-center gap-1">
                                  <Clock size={8} className="animate-pulse" /> PENDING SYNC
                                </span>
                              )}
                              {log.previous_sku && (
                                <span className="text-[8px] font-bold text-muted uppercase italic">
                                  (Was: {log.previous_sku})
                                </span>
                              )}
                            </div>
                            <p className="text-[10px] text-muted font-bold uppercase tracking-wider">
                              {new Date(log.created_at).toLocaleTimeString([], {
                                hour: '2-digit',
                                minute: '2-digit',
                              })}{' '}
                              •{' '}
                              <span
                                style={{ color: getUserColor(log.performed_by) }}
                                className="font-black"
                              >
                                {log.performed_by || 'Unknown'}
                              </span>
                            </p>
                          </div>
                        </div>

                        {!log.is_reversed &&
                          !log.order_number &&
                          !log.list_id &&
                          (() => {
                            const isStale = checkIsStaleRevival(log);
                            const isLatest = latestLogIdsPerItem.has(log.id);
                            const canUndo = isLatest && !isStale && !undoingId && !log.isOptimistic;

                            return (
                              <button
                                onClick={() => handleUndo(log.id)}
                                disabled={!canUndo}
                                className={`p-3 border rounded-2xl transition-all shadow-xl ${
                                  !canUndo
                                    ? 'opacity-20 cursor-not-allowed scale-90 bg-surface border-subtle text-muted'
                                    : 'bg-surface border-subtle text-content hover:bg-content hover:text-main'
                                }`}
                                title={
                                  !isLatest
                                    ? 'You can only undo the most recent action for this SKU (LIFO).'
                                    : isStale
                                      ? 'This record is over 48h old and requires manual restock.'
                                      : log.isOptimistic
                                        ? 'Syncing...'
                                        : undoingId === log.id
                                          ? 'Undoing...'
                                          : 'Undo Action'
                                }
                              >
                                {undoingId === log.id ? (
                                  <div className="animate-spin rounded-full h-4 w-4 border-2 border-content border-t-transparent" />
                                ) : isStale ? (
                                  <AlertCircle size={16} className="text-red-500" />
                                ) : (
                                  <Undo2 size={16} />
                                )}
                              </button>
                            );
                          })()}

                        {log.is_reversed && (
                          <span className="px-3 py-1 bg-main border border-subtle rounded-full text-[7px] font-black uppercase tracking-widest text-muted">
                            Reversed
                          </span>
                        )}
                      </div>

                      <div className="mt-5 flex items-center gap-3">
                        {log.action_type === 'MOVE' ? (
                          <div className="flex items-center gap-2 flex-1">
                            <div className="flex-1 px-3 py-2 bg-main/40 rounded-xl border border-subtle">
                              <p className="text-[7px] text-muted font-black uppercase tracking-widest mb-1">
                                From
                              </p>
                              <div className="flex items-baseline gap-1">
                                <p className="text-[11px] font-bold text-muted">
                                  {log.from_location}
                                </p>
                                <span className="text-[6px] opacity-40 font-black uppercase">
                                  {log.from_warehouse}
                                </span>
                              </div>
                            </div>
                            <ArrowRight size={12} className="text-muted" />
                            <div className="flex-1 px-3 py-2 bg-accent/5 rounded-xl border border-accent/20">
                              <p className="text-[7px] text-accent/50 font-black uppercase tracking-widest mb-1">
                                To
                              </p>
                              <div className="flex items-baseline gap-1">
                                <p className="text-[11px] font-black text-accent">
                                  {log.to_location}
                                </p>
                                <span className="text-[6px] opacity-40 font-black uppercase text-accent">
                                  {log.to_warehouse}
                                </span>
                              </div>
                            </div>
                          </div>
                        ) : (
                          <div className="flex-1 px-4 py-2 bg-surface/30 rounded-xl border border-subtle">
                            <p className="text-[7px] text-muted font-black uppercase tracking-widest mb-1">
                              Location
                            </p>
                            <div className="flex items-baseline gap-1">
                              <p className="text-[11px] font-black text-content">
                                {log.from_location || log.to_location || 'N/A'}
                              </p>
                              <span className="text-[6px] opacity-40 font-black uppercase">
                                {log.from_warehouse || log.to_warehouse || 'N/A'}
                              </span>
                            </div>
                          </div>
                        )}

                        <div className="text-right px-4">
                          <p className="text-[7px] text-muted font-black uppercase tracking-widest mb-1">
                            {log.action_type === 'EDIT'
                              ? 'Total Qty'
                              : log.action_type === 'PHYSICAL_DISTRIBUTION'
                                ? 'Units'
                                : 'Change'}
                          </p>
                          <p
                            className={`text-2xl font-black leading-none ${log.action_type === 'EDIT' ? 'text-accent' : log.action_type === 'PHYSICAL_DISTRIBUTION' ? 'text-orange-500' : 'text-content'}`}
                            data-testid="quantity-change"
                          >
                            {getDisplayQty(log)}
                          </p>
                        </div>
                      </div>

                      {log.prev_quantity !== null &&
                        log.new_quantity !== null &&
                        log.prev_quantity !== log.new_quantity && (
                          <div
                            className={`mt-4 flex gap-4 text-[8px] font-black uppercase tracking-widest border-t border-subtle pt-2 ${log.action_type === 'EDIT' ? 'text-accent opacity-60' : 'text-muted opacity-20'}`}
                          >
                            <span>
                              Stock Level: {log.prev_quantity} → {log.new_quantity}
                            </span>
                          </div>
                        )}

                      {checkIsStaleRevival(log) && (
                        <div className="mt-4 p-3 bg-red-500/10 border border-red-500/20 rounded-xl flex items-start gap-3">
                          <AlertCircle size={14} className="text-red-500 mt-0.5 shrink-0" />
                          <div>
                            <p className="text-[10px] font-bold text-red-500 uppercase tracking-tight">
                              Manual Restock Required
                            </p>
                            <p className="text-[9px] text-muted font-medium mt-1 leading-tight">
                              This activity occurred over 48 hours ago and the item has since been
                              removed. To restore this stock, please use the{' '}
                              <strong>Add Item</strong> feature in the Inventory screen.
                            </p>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))
        )}
      </div>

      <div className="fixed bottom-24 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 p-2 ios-glass rounded-full shadow-2xl animate-in slide-in-from-bottom-4 duration-700">
        <button
          onClick={sendDailyEmail}
          className="w-12 h-12 bg-white/5 text-muted border border-white/10 rounded-full flex items-center justify-center active:scale-90 ios-transition hover:text-content"
          title="Send Daily Email Now"
        >
          <Mail size={20} />
        </button>

        <div className="w-px h-6 bg-white/10 mx-1" />

        <button
          onClick={handleDownloadReport}
          className="px-6 h-12 bg-accent text-main rounded-full flex items-center gap-2 shadow-lg shadow-accent/20 hover:scale-105 active:scale-90 ios-transition font-black uppercase tracking-widest text-[10px]"
          title="Download Daily Report"
        >
          <FileDown size={18} />
          Report
        </button>
      </div>
    </div>
  );
};
