import React, { useState, useEffect, useCallback, useRef, Suspense } from 'react';
import { createPortal } from 'react-dom';
import { useLocation } from 'react-router-dom';
import ChevronUp from 'lucide-react/dist/esm/icons/chevron-up';
import type { PickingItem, CorrectionAction } from './DoubleCheckView';
import { lazyWithRetry } from '../../../utils/lazyWithRetry';
import { AddOnTargetPickerModal, type AddOnTargetCandidate } from './AddOnTargetPickerModal';
import { ShippingResolutionModal } from './board/ShippingResolutionModal';
import { useOrderGroups } from '../hooks/useOrderGroups';
import { appendPalletPhoto } from '../api/palletPhotos';
import { useAuth } from '../../../context/AuthContext';
import { useConfirmation } from '../../../context/ConfirmationContext';
import { usePickingSession } from '../../../context/PickingContext';
import { setPickingOverlayOpen } from '../../../lib/pickingOverlayStore';
import { useViewMode } from '../../../context/ViewModeContext';
import { useInventory } from '../../inventory/hooks/InventoryProvider';
import { useInventoryMutations } from '../../inventory/hooks/useInventoryMutations';
import type { InventoryItemWithMetadata } from '../../../schemas/inventory.schema';
import { getOptimizedPickingPath } from '../../../utils/pickingLogic';
import { locationsFromInventory, planPallets } from '../pallets/planPallets';
import { countCartPallets } from '../api/cartPalletCount';
import { collapseSplitForSku } from '../utils/pickLocation';
import { partitionGroupSweep } from '../utils/groupSweep';
import { holdsMergedGroupItems } from '../utils/mergedGroupState';
import { isDeliberateCombineGroupType } from '../../../utils/shippingClassification';
import { useBikeSets } from '../../../hooks/useBikeSkuSet';
import { supabase } from '../../../lib/supabase';
import type { Json } from '../../../lib/database.types';
import toast from 'react-hot-toast';
import { useScrollLock } from '../../../hooks/useScrollLock';
import { feedbackService } from '../../../services/feedback.service';
import { LIVE_LOCK_STATUS_LIST, siblingHeldByOther } from '../utils/siblingLock';
import { useModal } from '../../../context/ModalContext';
import { useOrderSplit } from '../hooks/useOrderSplit';
import { detectCombineConflicts } from '../ship/utils/combineConflicts';
import { combineOrdersIntoShipment } from '../ship/api/shipmentActions';
import { resolveBikeSets } from '../../../services/bikeSets.service';
import { isFedexOrder as isFedexOrderShared } from '../../../utils/shippingClassification';
import { queryClient } from '../../../lib/query-client';
import { declareShelfShort } from '../../../services/recount.service';
import { invalidateRecountAndInventoryQueries } from '../../../hooks/useOpenRecounts';
import { findZeroStockLines, type ZeroStockCandidate } from '../utils/zeroStockPrompt';
import { eventContext, recordPalletEvents } from '../api/palletEvents';
import {
  bulkMarkEvents,
  markEvent,
  type PalletEventPhase,
  type PalletEventRow,
} from '../utils/palletEvents';

/**
 * Whether a session's ticks are the order's verification progress, kept in
 * `verified_item_keys` for the next device and the Live Board's bar. Both ways
 * an order is opened tick lines the same way: to check (ready →
 * double_checking) and to pick (active, needs_correction → 'picking').
 */
function keepsVerificationProgress(mode: string): boolean {
  return mode === 'double_checking' || mode === 'picking';
}

const loadDoubleCheckView = () => import('./DoubleCheckView');
const DoubleCheckView = lazyWithRetry(() =>
  loadDoubleCheckView().then((m) => ({ default: m.DoubleCheckView }))
);

const NO_INVENTORY: InventoryItemWithMetadata[] = [];

/**
 * Mounts the inventory queries only while the drawer is open. The drawer is
 * always mounted (LayoutMain), and holding useInventory() there fired the
 * inventory list, stats and locations queries on every screen, Ship included.
 */
const DrawerInventoryFeed: React.FC<{
  onData: (data: InventoryItemWithMetadata[]) => void;
}> = ({ onData }) => {
  const { inventoryData } = useInventory();
  useEffect(() => {
    onData(inventoryData);
  }, [inventoryData, onData]);
  return null;
};

export const PickingCartDrawer: React.FC = () => {
  const { user } = useAuth();
  const { showConfirmation } = useConfirmation();
  const { open: openModal } = useModal();
  const { splitOrder } = useOrderSplit();
  const {
    externalDoubleCheckId,
    setExternalDoubleCheckId,
    viewMode,
    stockNavSignal,
    externalActionTrigger,
    setExternalActionTrigger,
    setViewMode,
  } = useViewMode();
  const { pathname } = useLocation();

  const {
    cartItems,
    setCartItems,
    activeListId,
    orderNumber,
    customer,
    sessionMode,
    setSessionMode,
    checkedBy: _checkedBy,
    correctionNotes,
    loadExternalList,
    lockForCheck,
    planPickForList,
    releaseCheck,
    parkOrder,
    returnToPicker,
    markAsReady,
    ownerId,
    notes,
    isNotesLoading,
    addNote,
    deleteList: _deleteList,
    resetSession,
    listStatus,
    setListStatus,
    isWaitingInventory,
    setIsWaitingInventory,
    claimAsPicker,
    cancelReopen,
    completeAddonGroup,
    reopenOrder,
  } = usePickingSession();
  const { resolveMixedShippingType } = useOrderGroups();

  const [inventoryData, setInventoryData] = useState<InventoryItemWithMetadata[]>(NO_INVENTORY);
  const { processPickingList: processMutation, recompletePickingList: recompleteMutation } =
    useInventoryMutations();
  const processPickingList = useCallback(
    async (listId: string, palletsQty?: number | null, totalUnits?: number | null) => {
      await processMutation.mutateAsync({ listId, palletsQty, totalUnits });
    },
    [processMutation]
  );
  const recompletePickingList = useCallback(
    async (listId: string, palletsQty?: number | null, totalUnits?: number | null) => {
      await recompleteMutation.mutateAsync({ listId, palletsQty, totalUnits });
    },
    [recompleteMutation]
  );
  const { bikes: cartBikeSkuSet, smallBikes: cartSmallBikeSkuSet } = useBikeSets(
    cartItems.map((i) => i.sku)
  );

  const [isOpen, setIsOpen] = useState(false);
  // currentView removed — always renders DoubleCheckView (idea-032 phase 2)
  const [checkedItems, setCheckedItems] = useState<Set<string>>(new Set());
  // idea-067 Phase 2 / Option A: COMBINE flow from open orders.
  const [combineModalOpen, setCombineModalOpen] = useState(false);
  const [pendingShippingResolutionGroupId, setPendingShippingResolutionGroupId] = useState<
    string | null
  >(null);
  const isOwner = user?.id === ownerId;

  const isRecompletingRef = React.useRef(false);
  const wasExternallyOpenedRef = React.useRef(false);
  const [isProcessingDeduction, setIsProcessingDeduction] = useState(false);
  const [isReadOnly, setIsReadOnly] = useState(false);
  const overriddenPalletCountRef = React.useRef<number | null>(null);
  useScrollLock(isOpen, () => setIsOpen(false));

  const totalItems = cartItems.length;
  const totalQty = cartItems.reduce((acc, item) => acc + (item.pickingQty || 0), 0);

  // Clear external-open flag and read-only flag when drawer closes
  useEffect(() => {
    if (!isOpen) {
      wasExternallyOpenedRef.current = false;
      setIsReadOnly(false);
    }
  }, [isOpen]);

  // Report the full-screen overlay state so LayoutMain can hide the bottom nav
  // while Double-Check / verification is up (the nav's z-100 pokes through the
  // z-60 overlay otherwise). Reset on unmount so the nav always comes back.
  useEffect(() => {
    setPickingOverlayOpen(isOpen);
  }, [isOpen]);
  useEffect(() => () => setPickingOverlayOpen(false), []);

  // idea-105 phase 1 — hydrate the verified-keys Set from DB first; if the
  // column is empty (legacy orders or freshly-parked-on-another-device-with-
  // no-network) fall back to the local browser cache. The DB column is the
  // cross-user source of truth so a Park Order on one device shows up to
  // the next picker.
  //
  // Which list holds edits made on THIS device that the column has not been
  // told about yet. It is the only thing the persist effect below may write,
  // and the one thing a hydration must not overwrite. Hydration used to land
  // in checkedItems like any other change and get mirrored straight back to
  // the DB: on re-open the pre-hydration empty Set was scheduled for writing,
  // the effect cleanup flushed it the moment the first read came back, the
  // second read (after lockForCheck) picked that [] up as truth, and a parked
  // order came up with every check gone.
  const dirtyListIdRef = useRef<string | null>(null);

  const hydrateVerifiedItems = useCallback(async (listId: string) => {
    // What the DB says becomes local state only if nothing was toggled here
    // while the read was in flight — a toggle is newer than what it read.
    const apply = (keys: string[], cache: boolean) => {
      if (dirtyListIdRef.current === listId) return;
      setCheckedItems(new Set(keys));
      if (cache) localStorage.setItem(`double_check_progress_${listId}`, JSON.stringify(keys));
    };
    try {
      // Column was added in migration 20260505140000 (idea-105 phase 1).
      // Supabase types haven't been regenerated yet — cast through unknown.
      const { data } = (await supabase
        .from('picking_lists')
        .select('verified_item_keys')
        .eq('id', listId)
        .maybeSingle()) as unknown as { data: { verified_item_keys: string[] | null } | null };
      if (data && Array.isArray(data.verified_item_keys)) {
        apply(data.verified_item_keys as string[], true);
        return;
      }
    } catch {
      /* swallow — fall through to localStorage */
    }
    const saved = localStorage.getItem(`double_check_progress_${listId}`);
    if (saved) {
      try {
        apply(JSON.parse(saved), false);
        return;
      } catch {
        /* corrupt, reset */
      }
    }
    apply([], false);
  }, []);

  // 0. Restore checked items on load — for an order opened to check AND one
  //    opened to pick: an active (manual) or needs_correction order loads in
  //    'picking', its lines are ticked the same way, and until 11 Sep those
  //    ticks lived only in this phone — gone on close, and never on the board
  //    (#TEST: 3/7 here, nothing there).
  useEffect(() => {
    if (keepsVerificationProgress(sessionMode) && activeListId) {
      void hydrateVerifiedItems(activeListId);
    } else {
      dirtyListIdRef.current = null;
      setCheckedItems(new Set());
    }
  }, [sessionMode, activeListId, hydrateVerifiedItems]);

  // Auto-open full-screen when entering reopened mode
  useEffect(() => {
    if (sessionMode === 'reopened' && !isOpen) {
      setIsOpen(true);
    }
  }, [sessionMode, isOpen]);

  // Close drawer when leaving picking view or navigating away from home.
  // Exceptions:
  //  - External trigger active (loading an order from Verification Board)
  //  - Drawer was opened externally (ref persists after externalDoubleCheckId clears)
  //  - Reopened mode transition
  useEffect(() => {
    if (externalDoubleCheckId) return;
    if (wasExternallyOpenedRef.current) return; // opened from non-home route — keep alive
    if ((viewMode !== 'picking' || pathname !== '/') && isOpen && sessionMode !== 'reopened') {
      setIsOpen(false);
    }
  }, [viewMode, pathname, externalDoubleCheckId, isOpen, sessionMode]);

  // 1. Auto-close when the order REACHES completed — not when it already was.
  //    Keyed on the transition, because the plain `=== 'completed'` read also
  //    fired on load: anything opened that was already complete drew itself and
  //    shut again in the same breath. That is Ship's Cart button on a finished
  //    order, and the Live Board's combined card whose anchor happens to be the
  //    completed member — it looked like the tap did nothing.
  //    The previous status is remembered per list: without the id, closing an
  //    order mid-check and then opening a finished one would read as that one
  //    "just completing".
  const prevListStatusRef = useRef<{ listId: string | null; status: string | null }>({
    listId: null,
    status: null,
  });
  useEffect(() => {
    const prev = prevListStatusRef.current;
    const listId = activeListId ? String(activeListId) : null;
    prevListStatusRef.current = { listId, status: listStatus };
    const justCompleted =
      prev.listId === listId &&
      prev.status !== null &&
      prev.status !== 'completed' &&
      listStatus === 'completed';
    if (justCompleted && isOpen && !isRecompletingRef.current) {
      setIsOpen(false);
      resetSession();
    }
  }, [listStatus, activeListId, isOpen, resetSession]);

  // Auto-close drawer when session is reset (e.g. after delete/cancel)
  useEffect(() => {
    if (sessionMode === 'idle' && totalItems === 0 && isOpen) {
      setIsOpen(false);
    }
  }, [sessionMode, totalItems, isOpen]);

  // 1. Handle External Trigger (from Header)
  useEffect(() => {
    if (externalDoubleCheckId) {
      console.log('🔄 [PickingCartDrawer] External trigger detected:', externalDoubleCheckId);
      const startDoubleCheck = async () => {
        try {
          console.log('📦 [PickingCartDrawer] Loading external list...');
          const list = (await loadExternalList(String(externalDoubleCheckId))) as
            | { id?: string; checked_by?: string | null }
            | undefined;
          console.log('📋 [PickingCartDrawer] List loaded:', list?.id, 'User:', user?.id);

          if (list && user) {
            const listData = list as {
              id?: string;
              checked_by?: string | null;
              group_id?: string | null;
              user_id?: string | null;
              is_waiting_inventory?: boolean | null;
            };

            // Read-only only if someone else currently has it locked open
            // (checked_by — a live lock set by lockForCheck, cleared by
            // releaseCheck). listData.user_id is just the original picker
            // and has no bearing on live presence — an order nobody
            // currently has open must never require a manual "Take Over".
            let needsTakeover = !!(listData.checked_by && listData.checked_by !== user.id);

            if (!needsTakeover && listData.group_id) {
              // Only a live lock counts: a completed sibling's checked_by is
              // who verified it, not who has it open (bug-035).
              const { data: groupSiblings } = await supabase
                .from('picking_lists')
                .select('checked_by, status')
                .eq('group_id', listData.group_id)
                .neq('id', String(externalDoubleCheckId))
                .not('checked_by', 'is', null)
                .in('status', LIVE_LOCK_STATUS_LIST);

              needsTakeover = groupSiblings?.some((s) => siblingHeldByOther(s, user.id)) || false;
            }

            const processOpen = async (readOnly: boolean, resumeWaiting: boolean) => {
              if (readOnly) {
                console.log('⚠️ [PickingCartDrawer] Read-only mode for list:', listData.id);
                setIsReadOnly(true);
                wasExternallyOpenedRef.current = true;
                setIsOpen(true);
                setExternalDoubleCheckId(null);
                await hydrateVerifiedItems(String(externalDoubleCheckId));
                return;
              }

              console.log('🔒 [PickingCartDrawer] Locking list for user...');
              await lockForCheck(String(externalDoubleCheckId));
              // Taking the order up IS "start picking", and it is the moment to
              // ask where the stock actually is — the addresses in the line were
              // chosen by the watcher when it imported the order and nothing had
              // looked at them since. Only re-read the cart if something moved;
              // a write echoes through realtime into every open cart.
              if (await planPickForList(String(externalDoubleCheckId))) {
                await loadExternalList(String(externalDoubleCheckId));
              }
              if (resumeWaiting && listData.is_waiting_inventory) {
                await supabase
                  .from('picking_lists')
                  .update({ is_waiting_inventory: false, status: 'active' })
                  .eq('id', String(listData.id));
                setIsWaitingInventory(false);
                setListStatus('active');
                setSessionMode('picking');
              }
              await hydrateVerifiedItems(String(externalDoubleCheckId));
              wasExternallyOpenedRef.current = true;
              setIsReadOnly(false);
              setIsOpen(true);
              setExternalDoubleCheckId(null);
            };

            const checkWaiting = (readOnly: boolean) => {
              if (listData.is_waiting_inventory && !readOnly) {
                showConfirmation(
                  'Resume Waiting Order?',
                  'This order is currently waiting for inventory. Do you want to resume picking or just view it?',
                  () => processOpen(false, true), // Confirm: Resume
                  () => processOpen(true, false), // Cancel: View Only
                  'Resume',
                  'View Only',
                  'warning'
                );
              } else {
                processOpen(readOnly, false);
              }
            };

            if (needsTakeover) {
              // User preference: Open in View Only by default. The DoubleCheckView has a "Take Over" button inside.
              checkWaiting(true);
              return;
            }

            checkWaiting(false);
          } else {
            console.error(
              '❌ [PickingCartDrawer] List or User missing. List:',
              !!list,
              'User:',
              !!user
            );
          }
        } catch (err) {
          console.error('💥 [PickingCartDrawer] Error in startDoubleCheck:', err);
        }
      };
      startDoubleCheck();
    }
  }, [
    externalDoubleCheckId,
    user,
    loadExternalList,
    lockForCheck,
    planPickForList,
    setExternalDoubleCheckId,
    showConfirmation,
    hydrateVerifiedItems,
    setIsWaitingInventory,
    setListStatus,
    setSessionMode,
  ]);

  // 3. Persist double-check progress.
  //    - localStorage: instant cache for the current device (offline-safe).
  //    - picking_lists.verified_item_keys: cross-user source of truth.
  //      Debounced so rapid toggles batch into one UPDATE.
  const dbWriteTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const checkedItemsRef = useRef(checkedItems);
  useEffect(() => {
    checkedItemsRef.current = checkedItems;
  }, [checkedItems]);

  const flushVerifiedItems = useCallback(async (listId: string, keysToFlush?: string[]) => {
    const keys = keysToFlush ?? Array.from(checkedItemsRef.current);
    localStorage.setItem(`double_check_progress_${listId}`, JSON.stringify(keys));
    try {
      const { data: row } = await supabase
        .from('picking_lists')
        .select('group_id')
        .eq('id', listId)
        .maybeSingle();

      if (row?.group_id) {
        await supabase
          .from('picking_lists')
          .update({ verified_item_keys: keys as unknown as Json } as never)
          .eq('group_id', row.group_id);
      } else {
        await supabase
          .from('picking_lists')
          .update({ verified_item_keys: keys as unknown as Json } as never)
          .eq('id', listId);
      }
    } catch (err) {
      console.warn('[PickingCartDrawer] Failed to flush verified_item_keys:', err);
    }
  }, []);

  useEffect(() => {
    if (!keepsVerificationProgress(sessionMode) || !activeListId) return;
    // Only edits made here go out (see dirtyListIdRef). Returning before the
    // cleanup is registered also means the cleanup below can only ever flush
    // keys the operator actually changed, for the list they belong to.
    if (dirtyListIdRef.current !== activeListId) return;
    const keys = Array.from(checkedItems);
    localStorage.setItem(`double_check_progress_${activeListId}`, JSON.stringify(keys));

    if (dbWriteTimer.current) clearTimeout(dbWriteTimer.current);
    dbWriteTimer.current = setTimeout(() => {
      void (async () => {
        try {
          const { data: row } = await supabase
            .from('picking_lists')
            .select('group_id')
            .eq('id', activeListId)
            .maybeSingle();

          if (row?.group_id) {
            await supabase
              .from('picking_lists')
              .update({ verified_item_keys: keys as unknown as Json } as never)
              .eq('group_id', row.group_id);
          } else {
            await supabase
              .from('picking_lists')
              .update({ verified_item_keys: keys as unknown as Json } as never)
              .eq('id', activeListId);
          }
        } catch (error) {
          console.warn('[PickingCartDrawer] Failed to persist verified_item_keys:', error);
        }
      })();
    }, 300);

    return () => {
      if (dbWriteTimer.current) {
        clearTimeout(dbWriteTimer.current);
        dbWriteTimer.current = null;
        void (async () => {
          try {
            const { data: row } = await supabase
              .from('picking_lists')
              .select('group_id')
              .eq('id', activeListId)
              .maybeSingle();

            if (row?.group_id) {
              await supabase
                .from('picking_lists')
                .update({ verified_item_keys: keys as unknown as Json } as never)
                .eq('group_id', row.group_id);
            } else {
              await supabase
                .from('picking_lists')
                .update({ verified_item_keys: keys as unknown as Json } as never)
                .eq('id', activeListId);
            }
          } catch {
            /* ignore cleanup error */
          }
        })();
      }
    };
  }, [checkedItems, activeListId, sessionMode]);

  /**
   * Ready to DC hands the order to whoever double-checks it, and they start
   * from zero (Rafael, 3 Oct 2026: after the send a tick means nothing, and
   * the next person had to clear every bike to use them again). The DB side
   * was already emptied by `markAsReady` and `releaseCheck`, but this phone
   * still held the full Set marked dirty: `markAsReady` flips the session to
   * `double_checking`, the persist effect re-ran and scheduled the full Set,
   * and `resetSession` flushed it in the cleanup — after the `[]`.
   *
   * So: write what is pending first (the last tick is still the picker's),
   * then stop this phone from writing for the list until it is sent.
   */
  const stopPersistingChecks = async () => {
    if (dbWriteTimer.current && activeListId) {
      clearTimeout(dbWriteTimer.current);
      dbWriteTimer.current = null;
      await flushVerifiedItems(activeListId);
    }
    dirtyListIdRef.current = null;
  };

  const dropLocalChecks = (listId: string | null) => {
    setCheckedItems(new Set());
    if (listId) localStorage.removeItem(`double_check_progress_${listId}`);
  };

  const handleMarkAsReady = async (finalOrderNumber: string) => {
    const listId = await markAsReady(cartItems, finalOrderNumber);
    if (listId) {
      setCheckedItems(new Set());
    }
  };

  const handleSendToVerifyQueue = async () => {
    if (!orderNumber) return;
    const sendingId = activeListId;
    await stopPersistingChecks();
    const listId = await markAsReady(cartItems, orderNumber);
    if (!listId) {
      // Nothing was sent: this phone's ticks are still the picker's progress.
      dirtyListIdRef.current = sendingId ?? null;
      return;
    }
    dropLocalChecks(sendingId);
    // Read the group before releaseCheck: the whole combined cart was picked
    // as one trip, so every member carries the picker's name.
    const { data: sent } = await supabase
      .from('picking_lists')
      .select('group_id')
      .eq('id', listId)
      .maybeSingle();
    await releaseCheck(listId);
    if (user) {
      const stamp = { sent_to_dc_by: user.id, sent_to_dc_at: new Date().toISOString() };
      const { error } = sent?.group_id
        ? await supabase
            .from('picking_lists')
            .update(stamp)
            .eq('group_id', sent.group_id)
            .eq('status', 'ready_to_double_check')
        : await supabase.from('picking_lists').update(stamp).eq('id', listId);
      if (error) console.error('Failed to stamp Ready to DC:', error);
    }
    setIsOpen(false);
    toast.success('Order sent to verification queue');
  };

  // Whether this order already went through Ready to DC — the slide to
  // complete only exists after that (29 sep 2026). Re-read when the status
  // moves: that is what a send, a return to picker or a realtime echo changes.
  const [sentToDc, setSentToDc] = useState(false);
  /**
   * Which list the `sentToDc` above is known for. Until the read lands, a tick
   * cannot say whose it is — the picker's or the checker's — so it waits in
   * `pendingMarksRef` instead of being guessed (3 Oct 2026).
   */
  const sentToDcForRef = useRef<string | null>(null);
  const pendingMarksRef = useRef<PalletEventRow[]>([]);
  useEffect(() => {
    sentToDcForRef.current = null;
    if (!activeListId) {
      setSentToDc(false);
      return;
    }
    let cancelled = false;
    void supabase
      .from('picking_lists')
      .select('sent_to_dc_at')
      .eq('id', activeListId)
      .maybeSingle()
      .then(({ data }) => {
        if (cancelled) return;
        const sent = !!data?.sent_to_dc_at;
        setSentToDc(sent);
        sentToDcForRef.current = activeListId;
        const waiting = pendingMarksRef.current;
        pendingMarksRef.current = [];
        recordPalletEvents(waiting.map((row) => ({ ...row, phase: sent ? 'check' : 'pick' })));
      });
    return () => {
      cancelled = true;
      // Ticks still waiting belong to the list being left: kept, phase unknown.
      const waiting = pendingMarksRef.current;
      pendingMarksRef.current = [];
      recordPalletEvents(waiting.map((row) => ({ ...row, phase: null })));
    };
  }, [activeListId, listStatus]);

  /**
   * Each tick, with its time, into the shipment's timeline (idea-245 F0). Before
   * Ready to DC a tick is the picker loading the pallet, and their order is the
   * load order; after it, whoever double-checks ticks to guide themselves.
   * Nothing reads these yet. Only real progress is recorded: not a read-only
   * view, not a mode that keeps no progress.
   */
  const recordsMarks = () =>
    !isReadOnly && !!activeListId && keepsVerificationProgress(sessionMode);
  const recordMarks = (rows: PalletEventRow[]) => {
    if (sentToDcForRef.current === activeListId) {
      const phase: PalletEventPhase = sentToDc ? 'check' : 'pick';
      recordPalletEvents(rows.map((row) => ({ ...row, phase })));
    } else {
      pendingMarksRef.current.push(...rows);
    }
  };

  const toggleCheck = (item: PickingItem, palletId: number | string) => {
    const key = `${palletId}-${item.sku}-${item.location}`;
    dirtyListIdRef.current = activeListId ?? null;
    // Mark or unmark is decided against the live Set, updated right here: two
    // fast taps land before React re-renders, and reading `checkedItems` from
    // this render made both of them a check while the screen ended unchecked.
    const checking = !checkedItemsRef.current.has(key);
    const live = new Set(checkedItemsRef.current);
    if (checking) live.add(key);
    else live.delete(key);
    checkedItemsRef.current = live;
    if (recordsMarks()) {
      recordMarks([markEvent(item, palletId, checking, null, eventContext(activeListId ?? null))]);
    }

    // Instant local toggle so the UI never feels laggy. The mutation
    // runs in the background and only rolls this back if all retries
    // are exhausted.
    setCheckedItems((prev) => {
      const next = new Set(prev);
      const isChecking = !next.has(key);
      if (isChecking) {
        next.add(key);
        feedbackService.progress(next.size, Math.max(1, totalItems));
      } else {
        next.delete(key);
        feedbackService.warning();
      }
      return next;
    });

    // In double_checking mode, checking off items is a verification action
    // recorded in verified_item_keys (via the debounced useEffect above).
    // It must NOT touch shelf inventory or items[].picked because items were
    // already physically collected off the shelves by the picker.
  };

  const applyBulkChecks = (next: Set<string>) => {
    const before = checkedItemsRef.current;
    checkedItemsRef.current = next;
    if (recordsMarks()) {
      recordMarks(
        bulkMarkEvents(before, next, cartItems, null, eventContext(activeListId ?? null))
      );
    }
    setCheckedItems(next);
  };

  const handleSelectAll = (keys?: string[]) => {
    dirtyListIdRef.current = activeListId ?? null;
    if (keys) {
      applyBulkChecks(new Set(keys));
      return;
    }

    // Fallback: the keys DoubleCheckView would build. Same reparto, but without
    // the picker's overrides — with them, these ordinals can differ from the
    // screen's (ship-pallet-truth F0).
    const path = getOptimizedPickingPath(cartItems, locationsFromInventory(inventoryData));
    const pallets = planPallets(path, { bikes: cartBikeSkuSet, smallBikes: cartSmallBikeSkuSet });

    const newChecked = new Set<string>();
    pallets.forEach((p) => {
      p.items.forEach((item) => {
        const key = `${p.id}-${item.sku}-${item.location}`;
        newChecked.add(key);
      });
    });

    applyBulkChecks(newChecked);
  };

  // X = park & close: unlock the order (checked_by = null, status untouched)
  // so it returns to its FedEx/Regular lane for anyone to take, and fully end
  // the local session so switching orders from the Live Board never prompts
  // the "active session" confirmation. Replaces the old Park Order button.
  const handleReleaseOrder = async () => {
    if (activeListId) {
      try {
        if (keepsVerificationProgress(sessionMode)) {
          if (dbWriteTimer.current) {
            clearTimeout(dbWriteTimer.current);
            dbWriteTimer.current = null;
          }
          await flushVerifiedItems(activeListId);
        }
        await parkOrder(activeListId);
        if (sessionMode === 'double_checking') {
          toast.success('Order parked — back in lane for anyone to pick up');
        }
      } catch (err) {
        console.error('Park on close failed:', err);
      }
    }
    resetSession();
    setViewMode('stock');
    setIsOpen(false);
  };

  // idea-129: pressing STOCK in the bottom nav must behave like pressing the X —
  // close the drawer (releasing the check) and reveal the stock view. The generic
  // close-on-viewMode-change effect above deliberately skips externally-opened
  // orders (Verification Board), which is exactly the case the operator reported,
  // so this explicit signal bypasses that exception.
  const releaseRef = useRef(handleReleaseOrder);
  releaseRef.current = handleReleaseOrder;
  const prevStockSignalRef = useRef(stockNavSignal);
  useEffect(() => {
    if (stockNavSignal === prevStockSignalRef.current) return; // mount / unrelated render
    prevStockSignalRef.current = stockNavSignal;
    if (isOpen) void releaseRef.current();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stockNavSignal]);

  const handleCorrectItem = async (action: CorrectionAction, targetListId?: string) => {
    if (!activeListId) return;
    const writeListId = targetListId ?? activeListId;
    // When a targetListId is provided, this is a sub-order edit inside a combined
    // group. Read that specific list's items from DB so we only mutate its row
    // (prevents the cross-sub-order duplication bug — see idea-057). A cart that
    // spans siblings is never the row's own contents either, target or not:
    // writing it copies their lines in (see mergedGroupState).
    const useDbSource = !!targetListId || holdsMergedGroupItems(cartItems, activeListId);
    try {
      let sourceItems: PickingItem[];
      if (useDbSource) {
        const { data: list, error: fetchErr } = await supabase
          .from('picking_lists')
          .select('items')
          .eq('id', writeListId)
          .single();
        if (fetchErr) throw fetchErr;
        sourceItems = Array.isArray(list?.items) ? (list.items as unknown as PickingItem[]) : [];
      } else {
        sourceItems = cartItems;
      }

      let newItems: PickingItem[];
      let logMessage: string;
      let shortageCall: (() => Promise<void>) | null = null;
      let damageNotice: string | null = null;

      switch (action.type) {
        case 'swap': {
          // A split pick is several rows for one SKU. Every correction below
          // addresses the SKU, so fold it back to one row first — see
          // collapseSplitForSku.
          const base = collapseSplitForSku(sourceItems, action.originalSku);
          const origItem = base.find((i) => i.sku === action.originalSku);
          const fromLocation = origItem?.location;
          const origWarehouse = origItem?.warehouse || 'LUDLOW';
          const prevQty = origItem?.pickingQty ?? 1;

          if (action.reason === 'Out of stock — replacing') {
            if (fromLocation) {
              shortageCall = async () => {
                await declareShelfShort(
                  action.originalSku,
                  origWarehouse,
                  fromLocation,
                  writeListId,
                  0,
                  action.reason
                );
                invalidateRecountAndInventoryQueries(queryClient);
              };
            }
          } else if (
            action.reason === 'Damaged — swapping' ||
            action.reason === 'Damaged units' ||
            action.reason === 'Damaged/defective'
          ) {
            damageNotice = `${prevQty} damaged box(es) of ${action.originalSku} stay at ${fromLocation || 'shelf'}. Make them S/D or deduct them by hand.`;
          }

          newItems = base.map((item) =>
            item.sku === action.originalSku
              ? {
                  ...item,
                  sku: action.replacement.sku,
                  location: action.replacement.location,
                  item_name: action.replacement.item_name,
                  warehouse: action.replacement.warehouse,
                  pickingQty: action.newQty ?? item.pickingQty,
                  sku_not_found: action.flags?.sku_not_found ?? false,
                  insufficient_stock: action.flags?.insufficient_stock ?? false,
                }
              : item
          );
          const qtySuffix = action.newQty !== undefined ? ` (qty ${action.newQty})` : '';
          // The address goes in the note. A third of the replacements on record
          // are the same SKU on both sides — the picker changed only where they
          // took it from — and without the locations there is nothing in the
          // note to say which way, so the whole category was unmeasurable.
          const toLocation = action.replacement.location;
          const where =
            fromLocation && toLocation && fromLocation !== toLocation
              ? ` [${fromLocation} → ${toLocation}]`
              : toLocation
                ? ` [${toLocation}]`
                : '';
          logMessage = action.reason
            ? `Replaced ${action.originalSku} → ${action.replacement.sku}${qtySuffix}${where}: ${action.reason}`
            : `Swapped SKU ${action.originalSku} → ${action.replacement.sku}${qtySuffix}${where}`;
          break;
        }
        case 'adjust_qty': {
          const origItem = sourceItems.find((i) => i.sku === action.sku);
          const location = origItem?.location;
          const origWarehouse = origItem?.warehouse || 'LUDLOW';
          const prevQty = origItem?.pickingQty ?? action.newQty;

          if (action.reason === 'Partial stock only') {
            if (location) {
              shortageCall = async () => {
                await declareShelfShort(
                  action.sku,
                  origWarehouse,
                  location,
                  writeListId,
                  action.newQty,
                  action.reason
                );
                invalidateRecountAndInventoryQueries(queryClient);
              };
            }
          } else if (
            action.reason === 'Damaged units' ||
            action.reason === 'Damaged/defective' ||
            action.reason === 'Damaged — swapping'
          ) {
            const diff = Math.max(0, prevQty - action.newQty);
            damageNotice = `${diff} damaged box(es) of ${action.sku} stay at ${location || 'shelf'}. Make them S/D or deduct them by hand.`;
          }

          newItems = collapseSplitForSku(sourceItems, action.sku).map((item) =>
            item.sku === action.sku
              ? { ...item, pickingQty: action.newQty, insufficient_stock: false }
              : item
          );
          logMessage = action.reason
            ? `Adjusted ${action.sku} qty to ${action.newQty}: ${action.reason}`
            : `Adjusted qty for ${action.sku} to ${action.newQty}`;
          break;
        }
        case 'remove': {
          const origItem = sourceItems.find((i) => i.sku === action.sku);
          const location = origItem?.location;
          const origWarehouse = origItem?.warehouse || 'LUDLOW';
          const prevQty = origItem?.pickingQty ?? 1;

          if (action.reason === 'Out of stock') {
            if (location) {
              shortageCall = async () => {
                await declareShelfShort(
                  action.sku,
                  origWarehouse,
                  location,
                  writeListId,
                  0,
                  action.reason
                );
                invalidateRecountAndInventoryQueries(queryClient);
              };
            }
          } else if (
            action.reason === 'Damaged units' ||
            action.reason === 'Damaged/defective' ||
            action.reason === 'Damaged — swapping'
          ) {
            damageNotice = `${prevQty} damaged box(es) of ${action.sku} stay at ${location || 'shelf'}. Make them S/D or deduct them by hand.`;
          }

          newItems = sourceItems.filter((item) => item.sku !== action.sku);
          logMessage = action.reason
            ? `Removed ${action.sku}: ${action.reason}`
            : `Removed SKU ${action.sku} from order`;
          break;
        }
        case 'add': {
          const base = collapseSplitForSku(sourceItems, action.item.sku);
          const existing = base.find((item) => item.sku === action.item.sku);
          if (existing) {
            newItems = base.map((item) =>
              item.sku === action.item.sku
                ? { ...item, pickingQty: item.pickingQty + action.item.pickingQty }
                : item
            );
            logMessage = action.reason
              ? `Added ${action.item.sku} (qty ${action.item.pickingQty}, total ${existing.pickingQty + action.item.pickingQty}): ${action.reason}`
              : `Extra item: ${action.item.sku}, qty ${action.item.pickingQty} (total ${existing.pickingQty + action.item.pickingQty})`;
          } else {
            newItems = [
              ...base,
              {
                sku: action.item.sku,
                location: action.item.location,
                warehouse: action.item.warehouse,
                item_name: action.item.item_name,
                pickingQty: action.item.pickingQty,
                sku_not_found: false,
                insufficient_stock: false,
              },
            ];
            logMessage = action.reason
              ? `Added ${action.item.sku} (qty ${action.item.pickingQty}): ${action.reason}`
              : `Extra item: ${action.item.sku}, qty ${action.item.pickingQty}`;
          }
          break;
        }
      }

      // Keep total_units in sync with the corrected items — leaving it stale
      // here is exactly what caused combined-order pallet/unit counts to
      // drift from reality after a swap/adjust/remove/add correction.
      const newTotalUnits = newItems.reduce((sum, item) => sum + (item.pickingQty || 0), 0);

      await supabase
        .from('picking_lists')
        .update({ items: newItems as unknown as Json, total_units: newTotalUnits })
        .eq('id', writeListId);

      await supabase.from('picking_list_notes').insert({
        list_id: writeListId,
        user_id: user!.id,
        message: logMessage,
      });

      if (shortageCall) {
        try {
          await shortageCall();
        } catch (shortErr) {
          console.error('Failed to declare shelf short:', shortErr);
        }
      }

      if (useDbSource) {
        // Refresh merged cart so the combined view reflects the sub-order change.
        await loadExternalList(activeListId);
      } else {
        setCartItems(newItems as unknown as typeof cartItems);
      }

      toast.success(logMessage);

      if (damageNotice) {
        toast(damageNotice, { duration: 6000, icon: '⚠️' });
      }
    } catch (err) {
      console.error('Correction failed:', err);
      toast.error('Correction failed');
    }
  };

  const handleDeduct = async (items: PickingItem[], isVerified: boolean) => {
    if (isProcessingDeduction) return false;
    setIsProcessingDeduction(true);

    try {
      // Claim as picker if current owner is Warehouse Team (script account)
      await claimAsPicker(activeListId!);

      if (!isVerified) {
        // Rule: All-or-nothing verification. Same hand-off as Ready to DC:
        // releaseCheck empties the keys, so this phone must not write them back.
        const releasingId = activeListId!;
        await stopPersistingChecks();
        await releaseCheck(releasingId);
        dropLocalChecks(releasingId);
        toast('Order released to queue (No deduction made)', {
          icon: '📋',
          duration: 4000,
        });
        return true;
      }

      // Check if this order belongs to a group
      const { data: mainOrder } = await supabase
        .from('picking_lists')
        .select('group_id, items, order_group:order_groups(group_type)')
        .eq('id', activeListId!)
        .single();

      // Calculate metrics from the MAIN ORDER's DB items only (not the merged cart)
      const mainDbItems = Array.isArray(mainOrder?.items)
        ? (mainOrder.items as Array<{ pickingQty?: number }>)
        : [];
      const mainUnits = mainDbItems.reduce((acc, item) => acc + (Number(item.pickingQty) || 0), 0);

      // Part B (Recount F2): Confirm zero stock before completing if unaddressed shortage lines exist
      const allCandidateItems: ZeroStockCandidate[] = [
        ...items,
        ...(Array.isArray(mainOrder?.items)
          ? (mainOrder.items as unknown as ZeroStockCandidate[])
          : []),
      ];
      const zeroStockLines = await findZeroStockLines(allCandidateItems, inventoryData);
      if (zeroStockLines.length > 0) {
        const confirmed = await new Promise<boolean>((resolve) => {
          openModal({
            type: 'confirm-zero-stock',
            lines: zeroStockLines,
            onConfirm: () => resolve(true),
            onCancel: () => resolve(false),
          });
        });
        if (!confirmed) {
          setIsProcessingDeduction(false);
          return false;
        }
      }

      // A deliberate combine (general/pickup) ships on however many pallets
      // its COMBINED load needs, not one count per order in it — two orders
      // of 2 bikes each can share the 1 pallet that holds 4. The 'fedex'
      // auto-group bucket is not this: it decouples the moment each member
      // completes and never shares a physical pallet, so it keeps counting
      // per order exactly as before (see isDeliberateCombineGroupType).
      const isDeliberateCombine =
        !!mainOrder?.group_id && isDeliberateCombineGroupType(mainOrder?.order_group?.group_type);

      // A manual override in DoubleCheckView is the group's truth once set —
      // for a deliberate combine or a lone order — and is never recalculated
      // under it. `items` is already the whole group's merged cart
      // (loadExternalList tags every line with the row it came from), so the
      // combined total is computed from it directly, unfiltered, and lives
      // on the anchor alone; every sibling completes at 0 (see below) so a
      // sum across the group never double-counts it.
      let pallets_qty: number;
      if (
        overriddenPalletCountRef.current !== null &&
        (isDeliberateCombine || !mainOrder?.group_id)
      ) {
        pallets_qty = overriddenPalletCountRef.current;
      } else {
        const cartItemsForPallets =
          mainOrder?.group_id && !isDeliberateCombine
            ? items.filter(
                (i) => !i.source_order || i.source_order === (orderNumber?.split(' / ')[0] || '')
              )
            : items;
        pallets_qty = await countCartPallets(
          cartItemsForPallets,
          locationsFromInventory(inventoryData)
        );
      }

      // Complete main order with its own metrics
      await processPickingList(activeListId!, pallets_qty, mainUnits);

      // Batch completion: complete sibling orders in the same group
      if (mainOrder?.group_id) {
        try {
          // idea-067 Phase 2 / Option A: 'reopened' siblings come from a
          // COMBINE flow where the user merged the current open order with a
          // recently-completed one. We finalize them via recompletePickingList
          // (delta vs snapshot), not processPickingList (which rejects
          // 'reopened' per migration 20260422120100).
          const COMPLETABLE_STATUSES = [
            'active',
            'ready_to_double_check',
            'double_checking',
            'needs_correction',
            'reopened',
          ];
          const { data: groupRows } = await supabase
            .from('picking_lists')
            .select('id, items, status, order_number')
            .eq('group_id', mainOrder.group_id)
            .neq('id', activeListId!)
            .in('status', COMPLETABLE_STATUSES);

          // Complete what the verifier actually had in front of them, not
          // whatever shares the group_id at this instant. An order can join the
          // group mid-check — the FedEx auto-grouper glues new arrivals to the
          // oldest open sibling — and then ride out on a completion nobody
          // pointed at it. #881394 went out that way on 9 sep 2026: five
          // seconds old, zero lines verified, one bike deducted off a shelf
          // nobody had walked to. The cart's items carry `source_list_id`
          // (loadExternalList tags every line with its owning row), so the set
          // of orders on screen is already known — anything outside it stays
          // on the board and gets combined by hand if it belongs here.
          const loadedListIds = new Set(
            cartItems
              .map((i) => i.source_list_id)
              .filter((id): id is string => typeof id === 'string')
          );
          const { siblings, gatecrashers } = partitionGroupSweep(groupRows ?? [], loadedListIds);

          if (gatecrashers.length > 0) {
            toast(
              `Left on the board: ${gatecrashers
                .map((s) => `#${s.order_number ?? s.id.slice(-6)}`)
                .join(', ')} — joined this group after you started`,
              { duration: 7000, icon: '👀' }
            );
          }

          if (siblings && siblings.length > 0) {
            // Give each sibling the main order's pallet photos (same R2 file,
            // just the URL — zero extra storage): a FedEx member ships on its
            // own and needs its own evidence in Ship. ADDED, never replaced —
            // overwriting the array wiped any photo a sibling had of its own.
            // append_pallet_photo skips a URL that is already there, and in a
            // deliberate combine it targets the same shipment, so it does not duplicate.
            const { data: mainOrderData } = await supabase
              .from('picking_lists')
              .select('pallet_photos, shipment:shipments(pallet_photos)')
              .eq('id', activeListId!)
              .single();
            const photosArray = Array.isArray(mainOrderData?.shipment?.pallet_photos)
              ? (mainOrderData.shipment.pallet_photos as string[])
              : Array.isArray(mainOrderData?.pallet_photos)
                ? (mainOrderData.pallet_photos as string[])
                : [];
            for (const sibling of siblings) {
              for (const url of photosArray) {
                await appendPalletPhoto(sibling.id, url);
              }
            }

            for (const sibling of siblings) {
              const siblingItems = Array.isArray(sibling.items)
                ? (sibling.items as Array<{ pickingQty?: number }>)
                : [];
              const siblingUnits = siblingItems.reduce(
                (acc, item) => acc + (Number(item.pickingQty) || 0),
                0
              );

              // In a deliberate combine, the shared shipment already holds the combined pallet count;
              // pass null so the sibling does not overwrite shipments.pallets_qty with 0.
              // In FedEx auto-groups, each order has its own separate shipment, so it calculates its own slice.
              const sibPalletsQty = isDeliberateCombine
                ? null
                : await countCartPallets(
                    siblingItems as unknown as PickingItem[],
                    locationsFromInventory(inventoryData)
                  );

              if (sibling.status === 'reopened') {
                // Reopened sibling — apply inventory delta vs completed_snapshot.
                await recompletePickingList(sibling.id, sibPalletsQty, siblingUnits);
              } else {
                await processPickingList(sibling.id, sibPalletsQty, siblingUnits);
              }
            }
            toast.success(`Group completed (${siblings.length + 1} orders)`, {
              duration: 4000,
            });
          }
        } catch (groupErr) {
          console.error('Batch completion warning:', groupErr);
          toast.error('Some orders in the group could not be completed');
        }
      }

      resetSession();
      setIsOpen(false);
      return true;
    } catch (error: unknown) {
      console.error('Operation failed:', error);
      toast.error(error instanceof Error ? error.message : 'Deduction failed');
      throw error;
    } finally {
      setIsProcessingDeduction(false);
    }
  };

  // Visibility: on home page in picking mode with active session, externally triggered,
  // or already open (keeps drawer alive when externalDoubleCheckId is cleared after load)
  const hasActiveSession = sessionMode !== 'idle' || totalItems > 0;
  const isVisible =
    (pathname === '/' && viewMode === 'picking' && hasActiveSession) ||
    !!externalDoubleCheckId ||
    isOpen;

  useEffect(() => {
    if (hasActiveSession || externalDoubleCheckId) void loadDoubleCheckView();
  }, [hasActiveSession, externalDoubleCheckId]);

  if (!isVisible) return null;

  return createPortal(
    <>
      {isOpen && <DrawerInventoryFeed onData={setInventoryData} />}
      {isOpen && (
        <div
          className="fixed inset-0 z-[120] flex items-center justify-center p-4 bg-main/60 backdrop-blur-md animate-in fade-in duration-200"
          onClick={handleReleaseOrder}
        >
          <div
            className="bg-surface border-subtle shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200 flex flex-col fixed inset-0 w-full h-full rounded-none border-0"
            onClick={(e) => e.stopPropagation()}
          >
            <Suspense fallback={null}>
              <DoubleCheckView
                customer={customer ?? null}
                cartItems={cartItems}
                orderNumber={orderNumber ?? null}
                activeListId={activeListId ?? null}
                initialAction={externalActionTrigger}
                onClearInitialAction={() => setExternalActionTrigger(null)}
                checkedItems={checkedItems}
                onToggleCheck={toggleCheck}
                onDeduct={handleDeduct}
                onReturnToPicker={(notes) => activeListId && returnToPicker(activeListId, notes)}
                isOwner={isOwner}
                notes={notes}
                isNotesLoading={isNotesLoading}
                onAddNote={addNote}
                onSelectAll={handleSelectAll}
                onPalletCountChange={(count) => {
                  overriddenPalletCountRef.current = count;
                }}
                status={listStatus}
                isWaitingInventory={isWaitingInventory}
                onSetWaitingInventory={setIsWaitingInventory}
                onBack={() => setIsOpen(false)}
                onRelease={handleReleaseOrder}
                onClose={handleReleaseOrder}
                onCorrectItem={handleCorrectItem}
                inventoryData={inventoryData}
                isReadOnly={isReadOnly}
                onTakeover={async () => {
                  if (!activeListId) return;
                  await lockForCheck(activeListId);
                  setIsReadOnly(false);
                  toast.success('You have taken over this order.');
                }}
                onMarkAsReady={() => orderNumber && handleMarkAsReady(orderNumber)}
                onSendToVerifyQueue={handleSendToVerifyQueue}
                sentToDc={sentToDc}
                onRecomplete={async (items) => {
                  if (!activeListId) return;
                  isRecompletingRef.current = true;
                  try {
                    const allLocations = locationsFromInventory(inventoryData);
                    const calcMetrics = async (its: PickingItem[]) => {
                      const totalUnits = its.reduce((acc, i) => acc + (i.pickingQty || 0), 0);
                      const palletsQty = await countCartPallets(its, allLocations);
                      return { totalUnits, palletsQty };
                    };

                    // idea-067 Phase 2: detect Add-On mode (source has group_id
                    // → 'general' group with one open sibling target). When so,
                    // route through complete_addon_group RPC (atomic on both
                    // orders) instead of plain recomplete.
                    const { data: src } = await supabase
                      .from('picking_lists')
                      .select('group_id, items')
                      .eq('id', activeListId)
                      .single();

                    if (src?.group_id) {
                      const { data: group } = await supabase
                        .from('order_groups')
                        .select('group_type')
                        .eq('id', src.group_id)
                        .single();

                      if (group?.group_type === 'general') {
                        const { data: groupRows } = await supabase
                          .from('picking_lists')
                          .select('id, items, order_number')
                          .eq('group_id', src.group_id)
                          .neq('id', activeListId)
                          .in('status', [
                            'active',
                            'ready_to_double_check',
                            'double_checking',
                            'needs_correction',
                          ]);

                        // Same rule as the batch path above: the Add-On finishes
                        // the order that was on screen, never whatever shares the
                        // group by the time the button is pressed. A 'general'
                        // group is what Combine writes into (the watchdog's
                        // same-customer auto-combine did too, until 9 Sep 2026),
                        // so this door needs the guard as much as the FedEx one.
                        const loadedListIds = new Set(
                          cartItems
                            .map((i) => i.source_list_id)
                            .filter((id): id is string => typeof id === 'string')
                        );
                        const { siblings, gatecrashers } = partitionGroupSweep(
                          groupRows ?? [],
                          loadedListIds
                        );
                        if (gatecrashers.length > 0) {
                          toast(
                            `Left on the board: ${gatecrashers
                              .map((s) => `#${s.order_number ?? s.id.slice(-6)}`)
                              .join(', ')} — joined this group after you started`,
                            { duration: 7000, icon: '👀' }
                          );
                        }

                        if (siblings && siblings.length >= 1) {
                          const target = siblings[0];
                          const targetItems = Array.isArray(target.items)
                            ? (target.items as unknown as PickingItem[])
                            : [];
                          const sourceItems = Array.isArray(src.items)
                            ? (src.items as unknown as PickingItem[])
                            : [];
                          const tm = await calcMetrics(targetItems);
                          const sm = await calcMetrics(sourceItems);
                          await completeAddonGroup(
                            activeListId,
                            target.id as string,
                            sm.palletsQty,
                            sm.totalUnits,
                            tm.palletsQty,
                            tm.totalUnits
                          );
                          resetSession();
                          setIsOpen(false);
                          return;
                        }
                      }
                    }

                    // Non-addon path: normal recomplete on the merged cart.
                    const { totalUnits, palletsQty } = await calcMetrics(items);
                    await recompletePickingList(activeListId, palletsQty, totalUnits);
                    resetSession();
                    setIsOpen(false);
                  } finally {
                    isRecompletingRef.current = false;
                  }
                }}
                onCancelReopen={async () => {
                  if (!activeListId) return;
                  // idea-067 Phase 2: if this reopened order belongs to a group
                  // (Add-On flow created one), dissolve it first so the target
                  // order returns to its prior status without a dangling
                  // group_id pointing nowhere.
                  const { data: srcRow } = await supabase
                    .from('picking_lists')
                    .select('group_id')
                    .eq('id', activeListId)
                    .single();
                  if (srcRow?.group_id) {
                    await supabase
                      .from('picking_lists')
                      .update({ group_id: null })
                      .eq('group_id', srcRow.group_id);
                    await supabase.from('order_groups').delete().eq('id', srcRow.group_id);
                  }
                  await cancelReopen(activeListId);
                  setIsOpen(false);
                }}
                onCombineWith={() => setCombineModalOpen(true)}
                onUngroup={async (orderId, groupId) => {
                  await splitOrder(orderId, {
                    groupId,
                    bikeSkuSet: cartBikeSkuSet,
                    onSuccess: async () => {
                      queryClient.invalidateQueries({ queryKey: ['picking_list_meta'] });
                      queryClient.invalidateQueries({ queryKey: ['group_members'] });
                      if (activeListId) await loadExternalList(activeListId);
                    },
                  });
                }}
                correctionNotes={correctionNotes}
              />
            </Suspense>

            {combineModalOpen && activeListId && (
              <AddOnTargetPickerModal
                sourceOrderId={activeListId}
                sourceCustomerId={customer?.id ?? null}
                sourceCustomerName={customer?.name ?? null}
                onClose={() => setCombineModalOpen(false)}
                onPick={async (target: AddOnTargetCandidate) => {
                  setCombineModalOpen(false);
                  if (!activeListId) return;
                  try {
                    // If the target had a stale singleton group_id (orphan
                    // from a prior canceled flow), free it up first so
                    // combine can assign cleanly. Drop the orphan
                    // order_groups row too.
                    if (target.stale_group_id) {
                      await supabase
                        .from('picking_lists')
                        .update({ group_id: null })
                        .eq('id', target.id);
                      await supabase.from('order_groups').delete().eq('id', target.stale_group_id);
                    }

                    // Branch by target status:
                    //   * completed  → reopen target + bind both into a group & shipment;
                    //                  the cart re-loads merged via group_id
                    //                  and final completion goes through the
                    //                  Add-On atomic RPC.
                    //   * any open   → just bind both into a group & shipment; cart
                    //                  re-loads merged.
                    if (target.status === 'completed') {
                      await reopenOrder(target.id, 'Add On — combined from open order');
                    }

                    // Query both orders to check conflicts and prepare shipment merge
                    const { data: ordersData, error: ordersError } = await supabase
                      .from('picking_lists')
                      .select(
                        'id, order_number, items, shipping_type, transport_company, ship_to_address_id, customer_id, is_shipped, group_id, shipment_id, order_group:order_groups(group_type), customer:customers(name, street, city, state, zip_code), shipment:shipments(ship_to_address_id, load_number)'
                      )
                      .in('id', [activeListId, target.id]);

                    if (ordersError || !ordersData || ordersData.length < 2) {
                      throw new Error('Failed to load order details for combine');
                    }

                    const activeOrder = ordersData.find((o) => o.id === activeListId);
                    const targetOrder = ordersData.find((o) => o.id === target.id);
                    if (!activeOrder || !targetOrder) {
                      throw new Error('Could not find both orders');
                    }

                    const executeCombine = async (overrides?: {
                      selectedAddressId?: string | null;
                      selectedLoadNumber?: string | null;
                    }) => {
                      const allSkus = [
                        ...(Array.isArray(activeOrder.items)
                          ? (activeOrder.items as Array<Record<string, unknown>>)
                          : []),
                        ...(Array.isArray(targetOrder.items)
                          ? (targetOrder.items as Array<Record<string, unknown>>)
                          : []),
                      ]
                        .map((i) => (typeof i?.sku === 'string' ? i.sku : ''))
                        .filter(Boolean);
                      const { bikes } = await resolveBikeSets(allSkus);

                      const toItemSlices = (
                        items: unknown
                      ): Array<{ sku: string; pickingQty: number }> => {
                        if (!Array.isArray(items)) return [];
                        return items.map((i) => {
                          const item = i as Record<string, unknown>;
                          return {
                            sku: String(item?.sku ?? ''),
                            pickingQty:
                              typeof item?.pickingQty === 'number'
                                ? item.pickingQty
                                : Number(item?.pickingQty ?? 1),
                          };
                        });
                      };

                      await combineOrdersIntoShipment({
                        targetOrderId: activeListId,
                        sourceOrderIds: [target.id],
                        selectedAddressId:
                          overrides?.selectedAddressId ?? conflictAnalysis.defaultAddressId,
                        selectedLoadNumber:
                          overrides?.selectedLoadNumber ?? conflictAnalysis.defaultLoadNumber,
                        targetItems: toItemSlices(activeOrder.items),
                        sourceItemsList: [toItemSlices(targetOrder.items)],
                        isFedex: isFedexOrderShared(
                          {
                            shipping_type: activeOrder.shipping_type,
                            transport_company: activeOrder.transport_company,
                            order_group: activeOrder.order_group,
                            items: Array.isArray(activeOrder.items)
                              ? (activeOrder.items as Array<Record<string, unknown>>).map((i) => ({
                                  sku: String(i?.sku ?? ''),
                                  pickingQty: typeof i?.pickingQty === 'number' ? i.pickingQty : 1,
                                }))
                              : [],
                          },
                          bikes
                        ),
                      });

                      // Re-fetch updated group_id
                      const { data: updatedOrder } = await supabase
                        .from('picking_lists')
                        .select('group_id')
                        .eq('id', activeListId)
                        .single();

                      const groupId = updatedOrder?.group_id;

                      // Re-load with the merged sibling items so DoubleCheckView
                      // shows the combined cart immediately.
                      queryClient.invalidateQueries({ queryKey: ['picking_list_meta'] });
                      queryClient.invalidateQueries({ queryKey: ['group_members'] });
                      await loadExternalList(activeListId);
                      toast.success(
                        target.status === 'completed'
                          ? `Combined with #${target.order_number} — completed order reopened`
                          : `Combined with #${target.order_number}`
                      );

                      if (groupId) {
                        const resolution = await resolveMixedShippingType(groupId);
                        if (resolution === 'needs-prompt') {
                          setPendingShippingResolutionGroupId(groupId);
                        }
                      }
                    };

                    const conflictAnalysis = detectCombineConflicts([
                      activeOrder as unknown as Parameters<
                        typeof detectCombineConflicts
                      >[0][number],
                      targetOrder as unknown as Parameters<
                        typeof detectCombineConflicts
                      >[0][number],
                    ]);

                    if (conflictAnalysis.hasConflict) {
                      openModal({
                        type: 'combine-conflict',
                        conflict: conflictAnalysis,
                        onConfirm: (res: {
                          selectedAddressId?: string;
                          selectedLoadNumber?: string;
                        }) => {
                          void executeCombine(res);
                        },
                      });
                      return;
                    }

                    await executeCombine();
                  } catch (err) {
                    console.error('Combine failed:', err);
                    if (target.status === 'completed' && user?.id) {
                      await supabase.rpc('cancel_reopen', {
                        p_list_id: target.id,
                        p_user_id: user.id,
                      });
                    }
                    toast.error('Combine failed. Please try again.');
                  }
                }}
              />
            )}

            {pendingShippingResolutionGroupId && (
              <ShippingResolutionModal
                groupId={pendingShippingResolutionGroupId}
                onClose={() => setPendingShippingResolutionGroupId(null)}
                onResolved={async () => {
                  setPendingShippingResolutionGroupId(null);
                  if (activeListId) await loadExternalList(activeListId);
                }}
              />
            )}
          </div>
        </div>
      )}

      {/* Collapsed State - Floating Trigger instead of Mini Bar */}
      {!isOpen && (
        <button
          onClick={() => setIsOpen(true)}
          className={`fixed bottom-24 left-4 right-4 p-4 rounded-2xl shadow-2xl flex items-center justify-between gap-2 cursor-pointer active:scale-95 transition-all z-40 border border-white/10 ${
            sessionMode === 'double_checking' ? 'bg-orange-500 text-white' : 'bg-accent text-main'
          }`}
        >
          <div className="flex items-center gap-3">
            <div className="p-2 bg-white/10 rounded-xl">
              <ChevronUp size={20} className="animate-bounce" />
            </div>
            <div className="font-extrabold uppercase tracking-widest text-[10px] text-left">
              <span className="opacity-70 block mb-0.5">Active Session</span>
              <span className="text-xs">
                {sessionMode === 'double_checking'
                  ? `Verifying #${orderNumber || activeListId?.slice(-6).toUpperCase()}`
                  : `${totalQty} Units · #${orderNumber || 'NEW'}`}
              </span>
            </div>
          </div>
          {totalQty > 0 && (
            <div className="px-3 py-1 bg-black/20 rounded-full text-[10px] font-black">
              {totalQty} UNITS
            </div>
          )}
        </button>
      )}
    </>,
    document.body
  );
};
