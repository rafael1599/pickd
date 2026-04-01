import { useEffect, useRef, useCallback } from 'react';
import { type User } from '@supabase/supabase-js';
import { supabase } from '../../../lib/supabase';
import { debounce, type DebouncedFunction } from '../../../utils/debounce';
import toast from 'react-hot-toast';
import type { CartItem } from './usePickingCart';
import type { Customer } from '../../../types/schema';
import type { Json } from '../../../integrations/supabase/types';

interface UsePickingSyncProps {
  user: User | null;
  sessionMode: 'building' | 'picking' | 'double_checking' | 'idle';
  cartItems: CartItem[];
  orderNumber: string | null;
  activeListId: string | null;
  listStatus: string;
  correctionNotes: string | null;
  checkedBy: string | null;
  setCartItems: (items: CartItem[]) => void;
  setActiveListId: (id: string | null) => void;
  setOrderNumber: (num: string | null) => void;
  customer: Customer | null;
  setCustomer: (cust: Customer | null) => void;
  loadNumber: string | null;
  setLoadNumber: (num: string | null) => void;
  setListStatus: (status: string) => void;
  setCheckedBy: (id: string | null) => void;
  ownerId: string | null;
  setOwnerId: (id: string | null) => void;
  setCorrectionNotes: (notes: string | null) => void;
  setSessionMode: (mode: 'building' | 'picking' | 'double_checking') => void;
  loadFromLocalStorage: () => void;
  showError: (title: string, msg: string) => void;
  resetSession: () => void;
  setIsSaving: (val: boolean) => void;
  setIsLoaded: (val: boolean) => void;
  setLastSaved: (val: Date | null) => void;
  isSaving: boolean;
  isLoaded: boolean;
  lastSaved: Date | null;
}

const SYNC_DEBOUNCE_MS = 1000;

export const usePickingSync = ({
  user,
  sessionMode,
  cartItems,
  orderNumber,
  activeListId,
  listStatus,
  correctionNotes,
  checkedBy,
  setCartItems,
  setActiveListId,
  setOrderNumber,
  customer,
  setCustomer,
  loadNumber,
  setLoadNumber,
  setListStatus,
  setCheckedBy,
  ownerId,
  setOwnerId,
  setCorrectionNotes,
  setSessionMode,
  loadFromLocalStorage,
  showError,
  resetSession,
  setIsSaving,
  setIsLoaded,
  setLastSaved,
  isSaving,
  isLoaded,
  lastSaved,
}: UsePickingSyncProps) => {
  // State removed and moved to PickingProvider via props

  // Legacy normalizeItems removed - database migration ensures consistent lowercase schema

  const isInitialSyncRef = useRef(true);
  const isSyncingRef = useRef(false);
  const takeoverSyncRef = useRef<string | null>(null);

  const sessionModeRef = useRef(sessionMode);
  const listStatusRef = useRef(listStatus);
  const correctionNotesRef = useRef(correctionNotes);
  const checkedByRef = useRef(checkedBy);
  const ownerIdRef = useRef(ownerId);

  useEffect(() => {
    sessionModeRef.current = sessionMode;
    listStatusRef.current = listStatus;
    correctionNotesRef.current = correctionNotes;
    checkedByRef.current = checkedBy;
    ownerIdRef.current = ownerId;
  }, [sessionMode, listStatus, correctionNotes, checkedBy, ownerId]);

  // 1. Initial Load Logic
  useEffect(() => {
    if (!user) {
      setCartItems([]);
      setActiveListId(null);
      setIsLoaded(true);
      return;
    }

    const loadSession = async () => {
      try {
        const FIVE_HOURS_MS = 1000 * 60 * 60 * 5;

        // A. Check for double-check session first (Highest priority)
        const { data: doubleCheckData } = await supabase
          .from('picking_lists')
          .select('*, customer:customers(*)')
          .eq('checked_by', user.id)
          .eq('status', 'double_checking')
          .limit(1)
          .maybeSingle();

        if (doubleCheckData) {
          const updatedAt = doubleCheckData.updated_at
            ? new Date(doubleCheckData.updated_at).getTime()
            : Date.now();
          const isStale = Date.now() - updatedAt > FIVE_HOURS_MS;

          if (isStale) {
            console.log('🧹 Double check session expired (>5h)');
            await supabase
              .from('picking_lists')
              .update({ status: 'ready_to_double_check', checked_by: null })
              .eq('id', doubleCheckData.id);
            resetSession();
          } else {
            setCartItems((doubleCheckData.items as unknown as CartItem[]) || []);
            setActiveListId(doubleCheckData.id as string);
            setOrderNumber(doubleCheckData.order_number || null);
            setCustomer((doubleCheckData.customer as Customer) || null);
            setLoadNumber(doubleCheckData.load_number || null);
            setListStatus(doubleCheckData.status as string);
            setCheckedBy(doubleCheckData.checked_by || null);
            setOwnerId(doubleCheckData.user_id || null);
            setCorrectionNotes(doubleCheckData.correction_notes || null);
            setSessionMode('double_checking');
          }
          setIsLoaded(true);
          return;
        }

        // B. Check for active picking sessions owned by this user
        const { data: pickingData, error } = await supabase
          .from('picking_lists')
          .select('*, customer:customers(*)')
          .eq('user_id', user.id)
          .in('status', ['active', 'needs_correction'])
          .order('updated_at', { ascending: false })
          .limit(1)
          .maybeSingle();

        if (error) console.error('Error loading picking session:', error);

        if (pickingData) {
          const updatedAt = pickingData.updated_at
            ? new Date(pickingData.updated_at).getTime()
            : Date.now();
          const isStale = Date.now() - updatedAt > FIVE_HOURS_MS;

          if (isStale) {
            console.log('🧹 Picking session expired (>5h)');
            await supabase.from('picking_lists').delete().eq('id', pickingData.id);
            resetSession();
          } else {
            setCartItems((pickingData.items as unknown as CartItem[]) || []);
            setActiveListId(pickingData.id as string);
            setOrderNumber(pickingData.order_number || null);
            setCustomer((pickingData.customer as Customer) || null);
            setLoadNumber(pickingData.load_number || null);
            setListStatus(pickingData.status as string);
            setCheckedBy(pickingData.checked_by || null);
            setOwnerId(pickingData.user_id || null);
            setCorrectionNotes(pickingData.correction_notes || null);
            setSessionMode('picking');
          }
        } else {
          // C. Sanitization Check: If user has an ID in localStorage but no valid session in DB
          const localId = localStorage.getItem('active_picking_list_id');
          if (localId) {
            const { data: remoteCheck } = await supabase
              .from('picking_lists')
              .select('status')
              .eq('id', localId)
              .maybeSingle();

            if (!remoteCheck || remoteCheck.status === 'completed') {
              console.log('🧹 Purging stale local session (completed or non-existent in DB)');
              resetSession();
            } else {
              loadFromLocalStorage();
            }
          } else {
            loadFromLocalStorage();
          }
        }
      } catch (err) {
        console.error('Session load failed:', err);
      } finally {
        setIsLoaded(true);
      }
    };

    loadSession();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- Intentionally depends only on user.id; setter functions are stable and adding them would cause re-subscribe loops on every render
  }, [user?.id]);

  // 2. Real-time Monitor
  useEffect(() => {
    if (!activeListId || !user) return;

    let channel: ReturnType<typeof supabase.channel> | null = null;
    let retryTimeout: NodeJS.Timeout;

    const showTakeoverAlert = async (takerId: string) => {
      if (takeoverSyncRef.current === activeListId) return;
      takeoverSyncRef.current = activeListId;

      try {
        const { data: profile } = await supabase
          .from('profiles')
          .select('full_name')
          .eq('id', takerId)
          .single();

        const takerName = profile?.full_name || 'Another user';

        toast(`${takerName} has taken over this order.\nYour session is being reset.`, {
          icon: 'ℹ️',
          duration: 4000,
          style: { border: '1px solid #3b82f6', padding: '16px', color: '#1e293b' },
        });

        setTimeout(() => {
          resetSession();
          takeoverSyncRef.current = null;
        }, 1500);
      } catch (err) {
        takeoverSyncRef.current = null;
        console.error('Error showing takeover alert:', err);
      }
    };

    let retryCount = 0;
    const setupSubscription = () => {
      const channelName = `list_status_sync_${activeListId}`;
      console.log(
        `🔌 [Realtime] Attempting connection to ${channelName}... (Attempt ${retryCount + 1}/3)`
      );

      // Ensure any previous zombie channel is cleaned
      if (channel) {
        supabase.removeChannel(channel);
        channel = null;
      }

      channel = supabase
        .channel(channelName)
        .on(
          'postgres_changes',
          {
            event: 'UPDATE',
            schema: 'public',
            table: 'picking_lists',
            filter: `id=eq.${activeListId}`,
          },
          (payload) => {
            const newData = payload.new;

            if (
              sessionModeRef.current === 'picking' &&
              newData.user_id &&
              (newData.user_id as string) !== user.id
            ) {
              showTakeoverAlert(newData.user_id as string);
              return;
            }

            if (
              sessionModeRef.current === 'double_checking' &&
              newData.checked_by &&
              (newData.checked_by as string) !== user.id
            ) {
              showTakeoverAlert(newData.checked_by as string);
              return;
            }

            if (newData.status !== listStatusRef.current) {
              // TERMINAL STATUS AUTO-CLEANUP
              if (newData.status === 'completed' || newData.status === 'cancelled') {
                console.log(
                  `🏁 [PickingSync] List ${activeListId} reached terminal status: ${newData.status}. Resetting local session.`
                );
                resetSession();
                return; // Early exit, session is gone
              }
              setListStatus(newData.status as string);
            }
            if (newData.correction_notes !== correctionNotesRef.current)
              setCorrectionNotes(newData.correction_notes as string | null);
            if (newData.checked_by !== checkedByRef.current)
              setCheckedBy(newData.checked_by as string | null);
            if (newData.user_id !== ownerIdRef.current)
              setOwnerId(newData.user_id as string | null);

            if (
              sessionModeRef.current === 'double_checking' &&
              (newData.status === 'active' || newData.status === 'needs_correction')
            ) {
              if (newData.user_id === user.id) setSessionMode('picking');
            }
          }
        )
        .subscribe((status, err) => {
          console.log(`Network status for ${channelName}:`, status);

          if (status === 'SUBSCRIBED') {
            retryCount = 0; // Reset on success
            console.log(`✅ [Realtime] Subscribed to ${channelName}`);
          }

          if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
            // CRITICAL: Only call removeChannel if NOT already closed to avoid infinite recursion
            if (status !== 'CLOSED' && channel) {
              supabase.removeChannel(channel);
              channel = null;
            }

            retryCount++;
            if (retryCount <= 3) {
              console.warn(
                `❌ [Realtime] Connection error (${status}). Retrying ${retryCount}/3 in 5s...`,
                err
              );
              retryTimeout = setTimeout(setupSubscription, 5000);
            } else {
              console.error(
                `❌ [Realtime] Max retries reached for ${channelName}. Live sync disabled.`
              );
              toast.error('Sync lost for this order. Changes by others may not appear.', {
                duration: 5000,
                id: `sync-error-${activeListId}`,
              });
            }
          }
        });
    };

    setupSubscription();

    return () => {
      console.log(`🧹 Cleaning up channel list_status_sync_${activeListId}`);
      if (channel) supabase.removeChannel(channel);
      if (retryTimeout) clearTimeout(retryTimeout);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- Subscribes to realtime channel; setter functions use refs to avoid re-subscribing on every state change
  }, [activeListId, user?.id]);

  // 3. Save Logic
  const saveToDb = async (
    items: CartItem[],
    userId: string,
    listId: string | null,
    orderNum: string | null
  ) => {
    if (sessionMode === 'building') return;
    if (!userId || isSyncingRef.current || sessionMode !== 'picking') return;

    isSyncingRef.current = true;
    setIsSaving(true);
    try {
      const sanitizedItems = items; // Data already in correct format from database
      if (listId) {
        const { error } = await supabase
          .from('picking_lists')
          .update({
            items: sanitizedItems as unknown as Json,
            order_number: orderNum,
            customer_id: customer?.id,
            load_number: loadNumber,
          })
          .eq('id', listId);
        if (error) throw error;
      } else if (items.length > 0) {
        const { data, error } = await supabase
          .from('picking_lists')
          .insert({
            user_id: userId,
            items: sanitizedItems as unknown as Json,
            status: 'active',
            order_number: orderNum,
            customer_id: customer?.id ?? null,
            load_number: loadNumber,
          })
          .select('*, customer:customers(*)')
          .single();
        if (error) throw error;
        if (data) {
          setActiveListId(data.id);
          setListStatus(data.status as string);
          setOwnerId(data.user_id);
        }
      }
      setLastSaved(new Date());
    } catch (err) {
      console.error('Failed to sync picking session:', err);
    } finally {
      setIsSaving(false);
      isSyncingRef.current = false;
    }
  };

  const debouncedSaveRef = useRef<DebouncedFunction<
    (items: CartItem[], userId: string, listId: string | null, orderNum: string | null) => void
  > | null>(null);
  useEffect(() => {
    debouncedSaveRef.current = debounce(
      (items: CartItem[], userId: string, listId: string | null, orderNum: string | null) =>
        saveToDb(items, userId, listId, orderNum),
      SYNC_DEBOUNCE_MS
    );
    return () => {
      debouncedSaveRef.current?.cancel();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- saveToDb is intentionally excluded; it reads sessionMode via closure and recreating the debounce on every dep change would defeat debouncing
  }, [sessionMode]);

  useEffect(() => {
    if (sessionMode === 'building' || !isLoaded || !user || sessionMode !== 'picking') return;
    if (cartItems.length === 0 && !activeListId && isInitialSyncRef.current) {
      isInitialSyncRef.current = false;
      return;
    }
    if (debouncedSaveRef.current) {
      debouncedSaveRef.current(cartItems, user.id, activeListId, orderNumber);
      isInitialSyncRef.current = false;
    }
  }, [cartItems, orderNumber, activeListId, isLoaded, user, sessionMode]); // debouncedSaveRef is a ref, not needed in deps

  // 4. Load External List
  const loadExternalList = useCallback(
    async (listId: string) => {
      if (!user) return;
      setIsSaving(true);
      try {
        const { data, error } = await supabase
          .from('picking_lists')
          .select('*, customer:customers(*)')
          .eq('id', listId)
          .single();
        if (error) throw error;
        if (data) {
          let allItems = (data.items as unknown as CartItem[]) || [];
          let combinedOrderNumber = data.order_number || null;

          // If order belongs to a group, merge items from all sibling orders
          if (data.group_id) {
            const { data: siblings } = await supabase
              .from('picking_lists')
              .select('items, order_number')
              .eq('group_id', data.group_id)
              .neq('id', listId)
              .neq('status', 'completed')
              .neq('status', 'cancelled');

            if (siblings && siblings.length > 0) {
              const orderNumbers = [data.order_number];
              for (const sibling of siblings) {
                const siblingItems = (sibling.items as unknown as CartItem[]) || [];
                // Tag each item with source_order for traceability
                const taggedItems = siblingItems.map((item) => ({
                  ...item,
                  source_order: sibling.order_number || 'unknown',
                }));
                allItems = [...allItems, ...taggedItems];
                if (sibling.order_number) orderNumbers.push(sibling.order_number);
              }
              // Tag original order items too
              allItems = allItems.map((item) =>
                item.source_order ? item : { ...item, source_order: data.order_number || 'unknown' }
              );
              combinedOrderNumber = orderNumbers.filter(Boolean).join(' / ');
            }
          }

          setCartItems(allItems);
          setActiveListId(data.id as string);
          setOrderNumber(combinedOrderNumber);
          setCustomer((data.customer as Customer) || null);
          setLoadNumber(data.load_number || null);
          setListStatus(data.status as string);
          setCheckedBy(data.checked_by || null);
          setOwnerId(data.user_id || null);
          setCorrectionNotes(data.correction_notes || null);
          setSessionMode('double_checking');
          return data;
        }
      } catch (err: unknown) {
        console.error('Failed to load external list:', err);
        showError('Load Error', err instanceof Error ? err.message : 'Unknown error');
      } finally {
        setIsSaving(false);
      }
    },
    [user, showError]
  );

  return { isLoaded, isSaving, lastSaved, loadExternalList };
};
