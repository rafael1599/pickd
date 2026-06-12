import React, { useEffect, useRef, useCallback } from 'react';
import { type User } from '@supabase/supabase-js';
import { supabase } from '../../../lib/supabase';
import { withSupabaseRetry } from '../../../lib/supabaseRetry';
import { debounce, type DebouncedFunction } from '../../../utils/debounce';
import toast from 'react-hot-toast';
import type { CartItem } from './usePickingCart';
import type { Customer } from '../../../types/schema';
import type { Json } from '../../../integrations/supabase/types';

interface UsePickingSyncProps {
  user: User | null;
  sessionMode: 'picking' | 'double_checking' | 'idle' | 'reopened';
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
  setIsWaitingInventory: (val: boolean) => void;
  setShippingType: (val: string | null) => void;
  setCheckedBy: (id: string | null) => void;
  ownerId: string | null;
  setOwnerId: (id: string | null) => void;
  setCorrectionNotes: (notes: string | null) => void;
  setSessionMode: (mode: 'picking' | 'double_checking' | 'reopened') => void;
  loadFromLocalStorage: () => void;
  showError: (title: string, msg: string) => void;
  resetSession: () => void;
  setIsSaving: (val: boolean) => void;
  setIsLoaded: (val: boolean) => void;
  setLastSaved: (val: Date | null) => void;
  isSaving: boolean;
  isLoaded: boolean;
  lastSaved: Date | null;
  isInWorkflowRef: React.MutableRefObject<boolean>;
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
  setIsWaitingInventory,
  setShippingType,
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
  isInWorkflowRef,
}: UsePickingSyncProps) => {
  // State removed and moved to PickingProvider via props

  // Legacy normalizeItems removed - database migration ensures consistent lowercase schema

  const isInitialSyncRef = useRef(true);
  const isSyncingRef = useRef(false);
  const takeoverSyncRef = useRef<string | null>(null);
  const loadSessionCalledRef = useRef(false);

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
      loadSessionCalledRef.current = false;
      return;
    }

    const loadSession = async () => {
      try {
        // Guard: Prevent double execution from React StrictMode
        if (loadSessionCalledRef.current) {
          setIsLoaded(true);
          return;
        }
        loadSessionCalledRef.current = true;

        // Guard: Skip if a workflow (generatePickingPath) is in progress
        if (isInWorkflowRef.current) {
          console.log('⏸️ [loadSession] Skipped — workflow in progress');
          setIsLoaded(true);
          return;
        }

        const FIVE_HOURS_MS = 1000 * 60 * 60 * 5;

        // A. Check for double-check session first (Highest priority)
        // Retry-wrapped: this query runs on every app load and was a
        // common flaky-network failure point (silent — the user sees
        // no order even though one exists).
        const { data: doubleCheckData } = await withSupabaseRetry(
          () =>
            supabase
              .from('picking_lists')
              .select('*, customer:customers(*)')
              .eq('checked_by', user.id)
              .eq('status', 'double_checking')
              .limit(1)
              .maybeSingle(),
          { label: 'usePickingSync.loadDoubleCheck' }
        );

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
            setShippingType(
              ((doubleCheckData as Record<string, unknown>).shipping_type as string | null) ?? null
            );
            setIsWaitingInventory(
              !!(doubleCheckData as Record<string, unknown>).is_waiting_inventory
            );
            setCheckedBy(doubleCheckData.checked_by || null);
            setOwnerId(doubleCheckData.user_id || null);
            setCorrectionNotes(doubleCheckData.correction_notes || null);
            setSessionMode('double_checking');
          }
          setIsLoaded(true);
          return;
        }

        // B. Check for active picking sessions owned by this user
        const { data: pickingData, error } = await withSupabaseRetry(
          () =>
            supabase
              .from('picking_lists')
              .select('*, customer:customers(*)')
              .eq('user_id', user.id)
              .in('status', ['active', 'needs_correction', 'reopened'])
              .order('updated_at', { ascending: false })
              .limit(1)
              .maybeSingle(),
          { label: 'usePickingSync.loadActive' }
        );

        if (error) console.error('Error loading picking session:', error);

        if (pickingData) {
          const updatedAt = pickingData.updated_at
            ? new Date(pickingData.updated_at).getTime()
            : Date.now();
          const isStale = Date.now() - updatedAt > FIVE_HOURS_MS;

          if (isStale) {
            // Stale (>5h since last touch): release the local session so the
            // user doesn't auto-resume, but DO NOT delete the order. Orders
            // can legitimately wait days/weeks/months for inventory and the
            // user expects to pick them up later from the orders list.
            // (Previously this DELETEd the row — caused order 879469 to vanish
            // overnight, 2026-04-30. See idea-099 in BACKLOG.md.)
            //
            // idea-099: when the idle order sits in `needs_correction`, auto-
            // flag it as waiting for inventory so it lands in the Waiting
            // bucket of the Verification Board instead of mixing with active
            // correction work. Admin-only RPC; failure is non-fatal (the order
            // is already safe — it just stays in needs_correction without the
            // waiting flag, which is the previous behavior).
            const isNeedsCorrection = pickingData.status === 'needs_correction';
            const alreadyWaiting = !!(pickingData as Record<string, unknown>).is_waiting_inventory;
            if (isNeedsCorrection && !alreadyWaiting) {
              const { error: markErr } = await supabase.rpc('mark_picking_list_waiting', {
                p_list_id: pickingData.id as string,
                p_reason: 'Auto-flagged: idle from a previous session',
              });
              if (markErr) {
                console.warn(
                  '⚠️ Could not auto-flag idle order as waiting (likely non-admin):',
                  markErr.message
                );
              } else {
                console.log('🕒 Idle needs_correction order auto-flagged as waiting');
              }
            }
            console.log('🧹 Picking session idle (>5h) — releasing local session');
            resetSession();
          } else {
            setCartItems((pickingData.items as unknown as CartItem[]) || []);
            setActiveListId(pickingData.id as string);
            setOrderNumber(pickingData.order_number || null);
            setCustomer((pickingData.customer as Customer) || null);
            setLoadNumber(pickingData.load_number || null);
            setListStatus(pickingData.status as string);
            setShippingType(
              ((pickingData as Record<string, unknown>).shipping_type as string | null) ?? null
            );
            setIsWaitingInventory(!!(pickingData as Record<string, unknown>).is_waiting_inventory);
            setCheckedBy(pickingData.checked_by || null);
            setOwnerId(pickingData.user_id || null);
            setCorrectionNotes(pickingData.correction_notes || null);
            setSessionMode(pickingData.status === 'reopened' ? 'reopened' : 'picking');
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

            if (
              !remoteCheck ||
              remoteCheck.status === 'completed' ||
              remoteCheck.status === 'cancelled'
            ) {
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
    // Polling fallback handle. When the realtime channel can't connect
    // after its own retries we drop to slow polling so the user still
    // sees status changes (takeovers, completions) — just at 30s
    // granularity instead of <1s. Cleared on cleanup or when the
    // channel finally reconnects.
    let pollTimer: ReturnType<typeof setInterval> | null = null;
    const POLL_INTERVAL_MS = 30_000;

    const stopPolling = () => {
      if (pollTimer) {
        clearInterval(pollTimer);
        pollTimer = null;
      }
    };

    const pollOnce = async () => {
      if (!activeListId) return;
      const { data, error } = await withSupabaseRetry(
        () =>
          supabase
            .from('picking_lists')
            .select(
              'status, user_id, checked_by, correction_notes, shipping_type, is_waiting_inventory'
            )
            .eq('id', activeListId)
            .maybeSingle(),
        { label: 'usePickingSync.pollFallback', maxAttempts: 2 }
      );
      if (error || !data) return;

      // Same fan-out as the realtime UPDATE handler below, but reusing
      // the refs to avoid double-firing on unchanged values.
      if (
        sessionModeRef.current === 'picking' &&
        data.user_id &&
        (data.user_id as string) !== user.id &&
        (data.user_id as string) !== ownerIdRef.current
      ) {
        showTakeoverAlert(data.user_id as string);
        return;
      }
      if (
        sessionModeRef.current === 'double_checking' &&
        data.checked_by &&
        (data.checked_by as string) !== user.id &&
        (data.checked_by as string) !== checkedByRef.current
      ) {
        showTakeoverAlert(data.checked_by as string);
        return;
      }
      if (data.status !== listStatusRef.current) {
        if (data.status === 'completed' || data.status === 'cancelled') {
          resetSession();
          stopPolling();
          return;
        }
        setListStatus(data.status as string);
      }
      // Note: shippingType/isWaitingInventory don't have stable refs to
      // compare against — accepting a possible no-op write here. React
      // bails out internally if value is identical.
      const shipNew = (data.shipping_type as string | null) ?? null;
      setShippingType(shipNew as string);
      const waitNew = !!data.is_waiting_inventory;
      setIsWaitingInventory(waitNew);
      if (data.correction_notes !== correctionNotesRef.current)
        setCorrectionNotes(data.correction_notes as string | null);
      if (data.checked_by !== checkedByRef.current) setCheckedBy(data.checked_by as string | null);
      if (data.user_id !== ownerIdRef.current) setOwnerId(data.user_id as string | null);
    };

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

            // Takeover detection: only alert if the field ACTUALLY CHANGED to a different user.
            // Without checking the ref, any UPDATE event (e.g., items change) would false-positive.
            if (
              sessionModeRef.current === 'picking' &&
              newData.user_id &&
              (newData.user_id as string) !== user.id &&
              (newData.user_id as string) !== ownerIdRef.current
            ) {
              showTakeoverAlert(newData.user_id as string);
              return;
            }

            if (
              sessionModeRef.current === 'double_checking' &&
              newData.checked_by &&
              (newData.checked_by as string) !== user.id &&
              (newData.checked_by as string) !== checkedByRef.current
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
            // No previous-value compare needed — the setter is a
            // useState dispatch in the parent, and React bails on
            // identical values internally via Object.is. The function
            // form here only made tsc unhappy because the prop is typed
            // as the narrow `(s: string) => void` (no SetStateAction).
            const newShippingType =
              ((newData as Record<string, unknown>).shipping_type as string | null) ?? null;
            setShippingType(newShippingType as string);
            setIsWaitingInventory(!!(newData as Record<string, unknown>).is_waiting_inventory);
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
            // Realtime is back — stop the polling fallback if it was on.
            stopPolling();
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
                `❌ [Realtime] Max retries reached for ${channelName}. Falling back to polling every ${POLL_INTERVAL_MS / 1000}s.`
              );
              toast(
                'Live sync lost. Falling back to slow polling — changes from others may take up to 30s.',
                { duration: 5000, id: `sync-fallback-${activeListId}`, icon: '⚠️' }
              );
              // Start polling if not already running. We keep trying the
              // channel in the background via `setupSubscription` is NOT
              // retried here, but `refetchOnReconnect` + the next mount
              // will revive it.
              if (!pollTimer) {
                // Fire one poll immediately so the user isn't waiting
                // a full interval to catch up on whatever they missed.
                void pollOnce();
                pollTimer = setInterval(() => {
                  void pollOnce();
                }, POLL_INTERVAL_MS);
              }
            }
          }
        });
    };

    setupSubscription();

    return () => {
      console.log(`🧹 Cleaning up channel list_status_sync_${activeListId}`);
      if (channel) supabase.removeChannel(channel);
      if (retryTimeout) clearTimeout(retryTimeout);
      stopPolling();
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
    if (!userId || isSyncingRef.current || sessionMode !== 'picking') return;

    isSyncingRef.current = true;
    setIsSaving(true);
    try {
      // Resolve the customer the same way generatePickingPath does: a manually
      // started order carries { name } with no id, so we must find-or-create the
      // customers row here — otherwise the typed customer name is dropped and the
      // order is saved with customer_id = null. Cache the id back into state so the
      // next debounced save reuses it (no repeated lookups / duplicate inserts).
      let resolvedCustomerId = customer?.id;
      if (!resolvedCustomerId && customer?.name?.trim()) {
        const name = customer.name.trim();
        const { data: existing } = await supabase
          .from('customers')
          .select('id')
          .eq('name', name)
          .maybeSingle();
        if (existing) {
          resolvedCustomerId = existing.id;
        } else {
          const { data: newCust } = await supabase
            .from('customers')
            .insert({ name })
            .select('id')
            .single();
          resolvedCustomerId = newCust?.id;
        }
        if (resolvedCustomerId) setCustomer({ ...customer, id: resolvedCustomerId });
      }

      const sanitizedItems = items; // Data already in correct format from database
      if (listId) {
        // Guard: never write merged group data back to DB.
        // Merged order_numbers contain ' / ' (e.g. "879270 / 879268").
        const isMergedGroup = orderNum?.includes(' / ');
        const updateData: Record<string, unknown> = {
          customer_id: resolvedCustomerId ?? null,
          load_number: loadNumber,
        };
        if (!isMergedGroup) {
          updateData.items = sanitizedItems as unknown as Json;
          updateData.order_number = orderNum;
        }
        const { error } = await supabase.from('picking_lists').update(updateData).eq('id', listId);
        if (error) throw error;
      } else if (items.length > 0) {
        const { data, error } = await supabase
          .from('picking_lists')
          .insert({
            user_id: userId,
            items: sanitizedItems as unknown as Json,
            status: 'active',
            order_number: orderNum,
            customer_id: resolvedCustomerId ?? null,
            load_number: loadNumber,
          })
          .select('*, customer:customers(*)')
          .single();
        if (error) throw error;
        if (data) {
          setActiveListId(data.id);
          setListStatus(data.status as string);
          setShippingType(
            ((data as Record<string, unknown>).shipping_type as string | null) ?? null
          );
          setIsWaitingInventory(!!(data as Record<string, unknown>).is_waiting_inventory);
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

  // saveToDb is recreated every render, so ITS closure (customer, loadNumber,
  // sessionMode) is always fresh — but the debounce used to capture ONE frozen
  // saveToDb per sessionMode change. A customer assigned or edited mid-session
  // was then auto-saved with the PREVIOUS customer_id (or null), silently
  // relinking the order to another customer. The ref always points at the
  // latest closure; the debounce itself is created once. A save that fires
  // after leaving picking mode is skipped by saveToDb's own (now fresh)
  // sessionMode guard, which is what the old [sessionMode] recreate-and-cancel
  // achieved.
  const saveToDbRef = useRef(saveToDb);
  useEffect(() => {
    saveToDbRef.current = saveToDb;
  });

  const debouncedSaveRef = useRef<DebouncedFunction<
    (items: CartItem[], userId: string, listId: string | null, orderNum: string | null) => void
  > | null>(null);
  useEffect(() => {
    debouncedSaveRef.current = debounce(
      (items: CartItem[], userId: string, listId: string | null, orderNum: string | null) =>
        saveToDbRef.current(items, userId, listId, orderNum),
      SYNC_DEBOUNCE_MS
    );
    return () => {
      debouncedSaveRef.current?.cancel();
    };
  }, []);

  useEffect(() => {
    if (!isLoaded || !user || sessionMode !== 'picking') return;
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

      // Force-save in-progress picking session before switching to verification.
      // In picking mode, sessions auto-sync via debounce, but the debounce may not
      // have fired yet. Flush it now to ensure the order is in DB before we overwrite state.
      if (sessionMode === 'picking' && cartItems.length > 0 && !activeListId && orderNumber) {
        try {
          const { data: saved } = await supabase
            .from('picking_lists')
            .insert({
              user_id: user.id,
              items: cartItems as unknown as Json,
              status: 'active',
              order_number: orderNumber,
            })
            .select('id')
            .single();
          if (saved) {
            console.log('💾 [loadExternalList] Flushed unsaved session to DB:', saved.id);
          }
        } catch (err) {
          console.error('Failed to flush session before switching:', err);
        }
      }

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
          // for display in DoubleCheckView. The merged state is READ-ONLY —
          // write paths (saveToDb, markAsReady) must guard against writing it back.
          if (data.group_id) {
            const { data: siblings } = await supabase
              .from('picking_lists')
              .select('id, items, order_number')
              .eq('group_id', data.group_id)
              .neq('id', listId)
              .neq('status', 'completed')
              .neq('status', 'cancelled');

            if (siblings && siblings.length > 0) {
              const orderNumbers = [data.order_number];
              // Tag anchor items with their owning list_id so per-item RPCs
              // (pick_item / unpick_item) route to the correct picking_list.
              allItems = allItems.map((item) => ({
                ...item,
                source_order: item.source_order || data.order_number || 'unknown',
                source_list_id: item.source_list_id || (data.id as string),
              }));
              for (const sibling of siblings) {
                const siblingItems = (sibling.items as unknown as CartItem[]) || [];
                const taggedItems = siblingItems.map((item) => ({
                  ...item,
                  source_order: sibling.order_number || 'unknown',
                  source_list_id: sibling.id as string,
                }));
                allItems = [...allItems, ...taggedItems];
                if (sibling.order_number) orderNumbers.push(sibling.order_number);
              }
              combinedOrderNumber = orderNumbers.filter(Boolean).join(' / ');
            }
          }

          setCartItems(allItems);
          setActiveListId(data.id as string);
          setOrderNumber(combinedOrderNumber);
          setCustomer((data.customer as Customer) || null);
          setLoadNumber(data.load_number || null);
          setListStatus(data.status as string);
          setShippingType(
            ((data as Record<string, unknown>).shipping_type as string | null) ?? null
          );
          setIsWaitingInventory(!!(data as Record<string, unknown>).is_waiting_inventory);
          setCheckedBy(data.checked_by || null);
          setOwnerId(data.user_id || null);
          setCorrectionNotes(data.correction_notes || null);
          // Infer sessionMode from order status — callers can override after
          setSessionMode(
            data.status === 'reopened'
              ? 'reopened'
              : data.status === 'active' || data.status === 'needs_correction'
                ? 'picking'
                : 'double_checking'
          );
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
