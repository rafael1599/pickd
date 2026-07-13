import React, { useState, useMemo, useCallback } from 'react';
import ChevronDown from 'lucide-react/dist/esm/icons/chevron-down';
import Search from 'lucide-react/dist/esm/icons/search';
// SortableContext removed — lanes use useDraggable+useDroppable, not sorting
import { useNavigate } from 'react-router-dom';
import X from 'lucide-react/dist/esm/icons/x';
import { useDoubleCheckList, type PickingList } from '../hooks/useDoubleCheckList';
import { useOrderGroups } from '../hooks/useOrderGroups';
import { useViewMode } from '../../../context/ViewModeContext';
import { usePickingSession } from '../../../context/PickingContext';
import { useConfirmation } from '../../../context/ConfirmationContext';
import { useAuth } from '../../../context/AuthContext';
import { autoClassifyShippingType } from '../../../utils/shippingClassification';
import { SortableOrderCard, StaticOrderCard } from './board/SortableOrderCard';
import { CompletedZone } from './board/CompletedZone';
import { WaitingZone } from './board/WaitingZone';
import { GroupCard } from './board/GroupCard';
import { WaitingReasonModal } from './WaitingReasonModal';
import { ReasonPicker } from './ReasonPicker';
import { supabase } from '../../../lib/supabase';
import { BoardMergeModal, type MergeTargetCandidate } from './board/BoardMergeModal';
import { ShippingTypeToggle } from './ShippingTypeToggle';
import toast from 'react-hot-toast';
import { createPortal } from 'react-dom';
import Pencil from 'lucide-react/dist/esm/icons/pencil';
import Camera from 'lucide-react/dist/esm/icons/camera';
import Clock from 'lucide-react/dist/esm/icons/clock';
import Hourglass from 'lucide-react/dist/esm/icons/hourglass';
import Play from 'lucide-react/dist/esm/icons/play';
import GitMerge from 'lucide-react/dist/esm/icons/git-merge';
import { useUnmarkWaiting } from '../hooks/useWaitingOrders';

// Zone IDs (must stay in sync with useBoardDnD)
// The "Pulling" queue (DB status ready_to_double_check) — the zone id keeps
// its historical name so useBoardDnD stays untouched.

// Completed Today auto-expands when the board is this quiet or quieter;
// with more active orders on screen it starts collapsed.
const COMPLETED_AUTO_OPEN_MAX = 6;
// How many completed orders of each type to show in the completed section.
const COMPLETED_SIDE_LIMIT = 6;

// Responsive tile grids — capped at 4 columns across the device so tiles
// grow with the resolution instead of multiplying (7 skinny columns on a
// big screen was unreadable). Half-width lanes cap at 2 each (4 total).
const CARD_GRID = 'grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-2';
const LANE_GRID = 'grid grid-cols-1 xl:grid-cols-2 gap-2';

// Lightweight drop target wrapper. Transparent drop region — line-based
// separators handle the visual structure.

interface VerificationBoardProps {
  onClose: () => void;
}

export const VerificationBoard: React.FC<VerificationBoardProps> = ({ onClose }) => {
  const { orders, completedOrders, refresh } = useDoubleCheckList();
  const { createGroup, addToGroup, removeFromGroup } = useOrderGroups();
  const { setExternalDoubleCheckId, setExternalOrderId, setViewMode, setExternalActionTrigger } =
    useViewMode();
  const unmarkWaiting = useUnmarkWaiting();
  const { cartItems, sessionMode, deleteList, reopenOrder, activeListId } = usePickingSession();
  const { showConfirmation } = useConfirmation();
  const { user } = useAuth();
  const navigate = useNavigate();

  // DnD logic — all zone reclassification, merge, prompts

  const [waitingCollapsed, setWaitingCollapsed] = useState(false);
  const [showWaitingOnTop, setShowWaitingOnTop] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [isSearchOpen, setIsSearchOpen] = useState(false);

  const [reopenReason, setReopenReason] = useState('');
  // Manual toggle for Completed Today. null = follow the auto rule
  // (open when the board is quiet, collapsed when it's busy).
  const [completedOverride, setCompletedOverride] = useState<boolean | null>(null);
  const [orderToMerge, setOrderToMerge] = useState<PickingList | null>(null);
  const [pendingWaitingOrder, setPendingWaitingOrder] = useState<PickingList | null>(null);
  const [pendingReopenOrder, setPendingReopenOrder] = useState<PickingList | null>(null);
  const [selectedMenuOrder, setSelectedMenuOrder] = useState<PickingList | null>(null);

  const handleMergeSelect = async (target: MergeTargetCandidate) => {
    if (!orderToMerge || !user?.id) return;
    try {
      // 1. Reopen or restore the target order if completed or cancelled
      if (target.status === 'completed') {
        const { error } = await supabase.rpc('reopen_picking_list', {
          p_list_id: target.id,
          p_reopened_by: user?.id,
          p_reason: `Merged with #${orderToMerge.order_number || 'unknown'}`,
        });
        if (error) throw error;
      } else if (target.status === 'cancelled') {
        const { error } = await supabase.rpc('restore_cancelled_order', {
          p_list_id: target.id,
          p_restored_by: user?.id,
          p_reason: `Merged with #${orderToMerge.order_number || 'unknown'}`,
        });
        if (error) throw error;
      }

      // 2. Perform the group binding
      let newGroupId = target.group_id;
      if (orderToMerge.group_id) {
        await addToGroup(orderToMerge.group_id, target.id);
        newGroupId = orderToMerge.group_id;
      } else if (target.group_id) {
        await addToGroup(target.group_id, orderToMerge.id);
        newGroupId = target.group_id;
      } else {
        newGroupId = await createGroup('general', [orderToMerge.id, target.id]);
      }

      // 3. Take ownership of all combined orders
      if (newGroupId && user?.id) {
        await supabase
          .from('picking_lists')
          .update({ user_id: user.id })
          .eq('group_id', newGroupId);
      }

      // 3. Refresh Board
      refresh();
      toast.success(`Successfully merged with #${target.order_number}`);
    } catch (err) {
      console.error('Merge action failed:', err);
      toast.error('Failed to merge orders. Please try again.');
    }
  };

  // ─── Classify orders into zones ────────────────────────────────────
  const {
    priorityOrders,
    fedexOrders,
    regularOrders,
    waitingOrders,
    pullingOrders,
    pullingShippingTypes,
    completedFedex,
    completedRegular,
    completedShowsDates,
    priorityShippingTypes,
  } = useMemo(() => {
    const priorityShipTypes = new Map<string, string>();
    const pullingShipTypes = new Map<string, 'fedex' | 'regular'>();
    const priority: PickingList[] = [];
    const fedex: PickingList[] = [];
    const regular: PickingList[] = [];
    const waiting: PickingList[] = [];
    const pulling: PickingList[] = [];

    const filteredOrders = orders.filter((o) => {
      if (!searchQuery) return true;
      const q = searchQuery.toLowerCase();
      const matchNum = String(o.order_number || o.id)
        .toLowerCase()
        .includes(q);
      const matchCust = String(o.profiles?.full_name || o.customer?.name || '')
        .toLowerCase()
        .includes(q);
      return matchNum || matchCust;
    });

    // Pre-calculate shipping types for all active orders
    const orderShippingTypes = new Map<string, 'fedex' | 'regular'>();
    for (const order of filteredOrders) {
      const st =
        order.shipping_type ??
        autoClassifyShippingType(
          order.items?.map((i) => ({
            sku: i.sku,
            pickingQty: (i as Record<string, unknown>).pickingQty as number,
          })) ?? [],
          {}
        );
      orderShippingTypes.set(order.id, st === 'fedex' ? 'fedex' : 'regular');
    }

    // Unify group-level states for combined orders
    const groupWaiting = new Map<string, boolean>();
    const groupShippingType = new Map<string, 'fedex' | 'regular'>();
    const groupStatus = new Map<string, string>();
    const groupIsPriority = new Map<string, boolean>();

    for (const order of filteredOrders) {
      if (order.group_id) {
        if (order.is_waiting_inventory) {
          groupWaiting.set(order.group_id, true);
        }
        if (orderShippingTypes.get(order.id) === 'fedex') {
          groupShippingType.set(order.group_id, 'fedex');
        }
        const currentStatus = groupStatus.get(order.group_id);
        if (order.status === 'active') {
          groupStatus.set(order.group_id, 'active');
        } else if (order.status === 'ready_to_double_check' && currentStatus !== 'active') {
          groupStatus.set(order.group_id, 'ready_to_double_check');
        } else if (!currentStatus) {
          groupStatus.set(order.group_id, order.status);
        }
        const hasProgress = order.verified_item_keys && order.verified_item_keys.length > 0;
        if (order.profiles?.full_name === 'Warehouse Team' && !hasProgress) {
          groupIsPriority.set(order.group_id, true);
        }
      }
    }

    // Classify orders
    for (const order of filteredOrders) {
      const isWaiting = order.group_id
        ? (groupWaiting.get(order.group_id) ?? order.is_waiting_inventory)
        : order.is_waiting_inventory;

      const shippingType = order.group_id
        ? (groupShippingType.get(order.group_id) ?? orderShippingTypes.get(order.id)!)
        : orderShippingTypes.get(order.id)!;

      const status = (
        order.group_id ? (groupStatus.get(order.group_id) ?? order.status) : order.status
      ) as PickingList['status'];

      const isPriority = order.group_id ? (groupIsPriority.get(order.group_id) ?? false) : false;

      const hasProgress = order.verified_item_keys && order.verified_item_keys.length > 0;
      const isWarehousePriority = order.profiles?.full_name === 'Warehouse Team' && !hasProgress;

      if (isWaiting) {
        waiting.push({ ...order, is_waiting_inventory: true });
        continue;
      }

      if (isWarehousePriority || isPriority) {
        priority.push({ ...order, status });
        priorityShipTypes.set(order.id, shippingType);
        continue;
      }

      if (status === 'active' || status === 'ready_to_double_check') {
        pulling.push({ ...order, status });
        pullingShipTypes.set(order.id, shippingType);
        continue;
      }

      if (shippingType === 'fedex') {
        fedex.push({ ...order, status });
      } else {
        regular.push({ ...order, status });
      }
    }

    // Oldest first (pick up what's been waiting longest).
    pulling.sort(
      (a, b) => new Date(a.updated_at ?? 0).getTime() - new Date(b.updated_at ?? 0).getTime()
    );

    // Classify completed orders
    const allCompletedFedex: PickingList[] = [];
    const allCompletedRegular: PickingList[] = [];
    const filteredCompleted = (completedOrders ?? []).filter((o) => {
      if (!searchQuery) return true;
      const q = searchQuery.toLowerCase();
      const matchNum = String(o.order_number || o.id)
        .toLowerCase()
        .includes(q);
      const matchCust = String(o.profiles?.full_name || o.customer?.name || '')
        .toLowerCase()
        .includes(q);
      return matchNum || matchCust;
    });
    for (const order of filteredCompleted) {
      const shippingType =
        order.shipping_type ??
        autoClassifyShippingType(
          order.items?.map((i) => ({
            sku: i.sku,
            pickingQty: (i as Record<string, unknown>).pickingQty as number,
          })) ?? [],
          {}
        );
      if (shippingType === 'fedex') {
        allCompletedFedex.push(order);
      } else {
        allCompletedRegular.push(order);
      }
    }

    const fedexDone = allCompletedFedex.slice(0, COMPLETED_SIDE_LIMIT);
    const regularDone = allCompletedRegular.slice(0, COMPLETED_SIDE_LIMIT);

    return {
      priorityOrders: priority,
      fedexOrders: fedex,
      regularOrders: regular,
      waitingOrders: waiting,
      pullingOrders: pulling,
      pullingShippingTypes: pullingShipTypes,
      completedFedex: fedexDone,
      completedRegular: regularDone,
      completedShowsDates: true,
      priorityShippingTypes: priorityShipTypes,
    };
  }, [orders, completedOrders]);

  const activeTotal =
    priorityOrders.length + fedexOrders.length + regularOrders.length + pullingOrders.length;
  const boardIsEmpty = activeTotal === 0;
  // While a drag is in progress every drop target must exist, even if the
  // zone is otherwise hidden for being empty.
  const isDraggingSomething = false;
  const completedExpanded = boardIsEmpty
    ? true
    : (completedOverride ?? activeTotal <= COMPLETED_AUTO_OPEN_MAX);
  const hasCompleted = completedFedex.length > 0 || completedRegular.length > 0;

  // ─── Render ────────────────────────────────────────────────────────
  // ─── Helpers ──────────────────────────────────────────────────────
  const handleOrderSelect = useCallback(
    (order: PickingList) => {
      const proceed = () => {
        setExternalDoubleCheckId(order.id);
        setViewMode('picking');
        onClose();
      };
      // idea-130: an active picking session no longer hard-blocks the board.
      if (activeListId && cartItems.length > 0 && sessionMode === 'picking') {
        // Same order the user was already working on → re-enter without friction.
        if (String(order.id) === String(activeListId)) {
          proceed();
          return;
        }
        // Different order → warn + confirm instead of blocking. The current order
        // is NOT deleted: it keeps its status and stays on the board, and the
        // existing take-over validations still run on the external-load path.
        showConfirmation(
          'Open a different order?',
          `You have an active session on another order. It will stay on the board (nothing is deleted) and you'll switch to #${order.order_number ?? order.id}.`,
          proceed,
          () => {},
          'Switch order',
          'Cancel'
        );
        return;
      }
      proceed();
    },
    [
      activeListId,
      cartItems.length,
      sessionMode,
      setExternalDoubleCheckId,
      setViewMode,
      onClose,
      showConfirmation,
    ]
  );

  const handleDelete = useCallback(
    (order: PickingList) => {
      showConfirmation(
        'Delete Order',
        'This order will be cancelled permanently.',
        () => deleteList(order.id),
        () => {},
        'Delete',
        'Cancel'
      );
    },
    [showConfirmation, deleteList]
  );

  const handleUngroup = useCallback(
    async (order: PickingList) => {
      if (order.group_id) {
        await removeFromGroup(order.id, order.group_id);
        refresh();
      }
    },
    [removeFromGroup, refresh]
  );

  // Helper to render order cards for a lane, grouping by group_id
  const renderOrderCards = (laneOrders: PickingList[], shippingType: 'fedex' | 'regular') => {
    const grouped = new Map<string, PickingList[]>();
    const ungrouped: PickingList[] = [];

    for (const order of laneOrders) {
      if (order.group_id) {
        const arr = grouped.get(order.group_id) || [];
        arr.push(order);
        grouped.set(order.group_id, arr);
      } else {
        ungrouped.push(order);
      }
    }

    return (
      <div className={LANE_GRID}>
        {Array.from(grouped.entries()).map(([groupId, groupOrders]) => (
          <GroupCard
            key={groupId}
            orders={groupOrders}
            groupType={groupOrders[0]?.order_group?.group_type ?? 'general'}
            onSelect={handleOrderSelect}
            onDelete={handleDelete}
            onUngroup={handleUngroup}
            onMerge={setSelectedMenuOrder}
          />
        ))}
        {ungrouped.map((order) => (
          <SortableOrderCard
            key={order.id}
            order={order}
            shippingType={shippingType}
            showShippingBadge={false}
            onSelect={handleOrderSelect}
            onDelete={handleDelete}
            onUngroup={handleUngroup}
            onMerge={setSelectedMenuOrder}
          />
        ))}
      </div>
    );
  };

  const showPulling = pullingOrders.length > 0 || isDraggingSomething;
  const showWaiting = waitingOrders.length > 0 || isDraggingSomething;
  const completedCount = completedFedex.length + completedRegular.length;

  const waitingZoneElement = showWaiting && (
    <div className="border-b border-subtle bg-amber-500/[0.02] w-full">
      <button
        onClick={() => setWaitingCollapsed((v) => !v)}
        className="w-full flex items-center justify-center gap-2 py-2 md:py-3 hover:bg-amber-500/5 transition-colors"
      >
        <span className="text-sm md:text-base font-black uppercase tracking-widest text-amber-400">
          Waiting for Inventory
        </span>
        {waitingOrders.length > 0 && (
          <span className="text-sm text-muted/60">({waitingOrders.length})</span>
        )}
        <ChevronDown
          size={14}
          className={`text-amber-400/60 transition-transform ${
            waitingCollapsed ? '' : 'rotate-180'
          }`}
        />
      </button>
      {!waitingCollapsed && (
        <div className="px-2 pb-2 md:px-4 md:pb-3">
          {waitingOrders.length > 0 ? (
            <WaitingZone
              orders={waitingOrders}
              onSelect={handleOrderSelect}
              onMerge={setSelectedMenuOrder}
            />
          ) : (
            <div className="text-center text-xs text-muted/40 italic py-1">
              Drop here → waiting for inventory
            </div>
          )}
        </div>
      )}
    </div>
  );

  // ─── Render ───────────────────────────────────────────────────────
  return (
    <>
      {/* z-[110]: above the bottom nav (z-100) so the board is a full takeover.
          Internal modals (GroupOrder z-150, CrossLane/WaitingReason z-200) stay on top. */}
      <div className="fixed inset-0 z-[110] flex flex-col bg-main">
        {/* Header */}
        <div className="px-3 py-2 md:px-5 md:py-3 border-b border-subtle bg-surface flex flex-col items-center justify-center relative shrink-0 gap-1.5">
          <h2 className="text-base md:text-xl lg:text-xl font-black text-content uppercase tracking-tight text-center">
            Live Board
          </h2>
          {(priorityOrders.length > 0 ||
            pullingOrders.length > 0 ||
            completedCount > 0 ||
            waitingOrders.length > 0) && (
            <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-xs md:text-sm font-bold">
              {priorityOrders.length > 0 && (
                <div className="flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-red-500/10 text-red-500">
                  <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
                  <span>Available: {priorityOrders.length}</span>
                </div>
              )}
              {pullingOrders.length > 0 && (
                <div className="flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-sky-500/10 text-sky-500">
                  <span className="w-1.5 h-1.5 rounded-full bg-sky-500" />
                  <span>Pulling: {pullingOrders.length}</span>
                </div>
              )}
              {completedCount > 0 && (
                <div className="flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-emerald-500/10 text-emerald-500">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                  <span>Completed: {completedCount}</span>
                </div>
              )}
              {waitingOrders.length > 0 && (
                <label className="flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-amber-500/10 border border-amber-500/20 text-amber-500 cursor-pointer hover:bg-amber-500/20 transition-all select-none">
                  <input
                    type="checkbox"
                    checked={showWaitingOnTop}
                    onChange={(e) => setShowWaitingOnTop(e.target.checked)}
                    className="w-3.5 h-3.5 accent-red-500 rounded cursor-pointer"
                  />
                  <span>Waiting for Inventory</span>
                  <span className="inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full bg-red-500 text-white text-[10px] font-black leading-none ml-0.5 animate-pulse">
                    {waitingOrders.length}
                  </span>
                </label>
              )}
            </div>
          )}
          <div className="absolute right-12 md:right-16 top-1/2 -translate-y-1/2 flex items-center gap-2">
            <button
              onClick={() => {
                setIsSearchOpen(!isSearchOpen);
                if (isSearchOpen) setSearchQuery('');
              }}
              className={`p-2 transition-colors rounded-full ${isSearchOpen || searchQuery ? 'text-sky-400 bg-sky-400/10' : 'text-muted hover:text-content hover:bg-content/5'}`}
            >
              <Search className="w-5 h-5 md:w-6 md:h-6" />
            </button>
          </div>
          <button
            onClick={onClose}
            className="absolute right-3 md:right-5 top-1/2 -translate-y-1/2 p-2 text-muted hover:text-content transition-colors"
          >
            <X className="w-6 h-6" />
          </button>
        </div>

        {/* Search Bar */}
        {(isSearchOpen || searchQuery) && (
          <div className="px-3 md:px-5 py-2 border-b border-subtle bg-surface/50 animate-in slide-in-from-top-2 duration-200">
            <div className="relative">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
              <input
                type="text"
                autoFocus
                placeholder="Search by order # or customer..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full bg-[#1a1a1a] border border-white/10 rounded-xl pl-9 pr-8 py-2.5 text-sm text-content placeholder-muted focus:outline-none focus:border-sky-500/50 focus:ring-1 focus:ring-sky-500/50 transition-all"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery('')}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted hover:text-white"
                >
                  <X size={14} />
                </button>
              )}
            </div>
          </div>
        )}

        {/* Full device width — no max-w cap; tiles scale with the viewport. */}
        <div className="flex-1 overflow-y-auto min-h-0 pb-20 w-full">
          {/* Show Waiting Zone on top if toggled */}
          {showWaitingOnTop && waitingZoneElement}

          {/* Priority — auto-populated, top of the board (rare). */}
          {priorityOrders.length > 0 && (
            <div className="border-b border-subtle px-2 py-2 md:px-4 md:py-3 w-full">
              <div className="flex items-center justify-center gap-2 mb-2 md:mb-3">
                <span className="text-sm md:text-base font-black uppercase tracking-widest text-red-400">
                  Available
                </span>
                <span className="text-sm text-muted/60">({priorityOrders.length})</span>
              </div>
              <div className={CARD_GRID}>
                {priorityOrders.map((order) => (
                  <SortableOrderCard
                    key={order.id}
                    order={order}
                    shippingType={
                      (priorityShippingTypes.get(order.id) as 'fedex' | 'regular') ?? 'regular'
                    }
                    onSelect={handleOrderSelect}
                    onDelete={handleDelete}
                    onUngroup={handleUngroup}
                  />
                ))}
              </div>
            </div>
          )}

          {/* FEDEX | REGULAR lanes (needs_correction / double_checking).
              Empty lanes are hidden — unless a drag is in progress, when both
              drop targets must be reachable. A lone lane takes the full width. */}
          {/* FEDEX | REGULAR lanes (needs_correction / double_checking).
              Both lanes are always shown side-by-side. */}
          <div className="grid grid-cols-2 divide-x divide-subtle border-b border-subtle">
            <div className="bg-purple-500/[0.08] min-h-[44px] w-full">
              <div className="h-[5px] md:h-[6px] bg-purple-500/70" />
              <div className="px-2 py-2 md:px-4 md:py-3">
                {fedexOrders.length > 0 ? (
                  renderOrderCards(fedexOrders, 'fedex')
                ) : (
                  <div className="text-center text-xs text-purple-400/40 italic py-2">
                    Drop here → FedEx
                  </div>
                )}
              </div>
            </div>
            <div className="bg-emerald-500/[0.08] min-h-[44px] w-full">
              <div className="h-[5px] md:h-[6px] bg-emerald-500/70" />
              <div className="px-2 py-2 md:px-4 md:py-3">
                {regularOrders.length > 0 ? (
                  renderOrderCards(regularOrders, 'regular')
                ) : (
                  <div className="text-center text-xs text-emerald-400/40 italic py-2">
                    Drop here → Regular
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* PULLING — every order of the day still being worked (actively
              picked + finished picking, awaiting verification). Full-width
              responsive grid, no truncation: the board should look full.
              Dropping here keeps the historical semantics (mark as ready). */}
          {showPulling && (
            <div className="border-b border-subtle px-2 py-2 md:px-4 md:py-3 w-full">
              <div className="flex items-center justify-center gap-2 mb-2 md:mb-3">
                <span className="text-sm md:text-base font-black uppercase tracking-widest text-sky-400">
                  Pulling
                </span>
                {pullingOrders.length > 0 && (
                  <span className="text-sm text-muted/60">({pullingOrders.length})</span>
                )}
              </div>
              {pullingOrders.length === 0 ? (
                <div className="text-center text-xs text-muted/40 italic py-2">
                  Drop here → mark as pulled, ready to verify
                </div>
              ) : (
                (() => {
                  const grouped = new Map<string, PickingList[]>();
                  const ungrouped: PickingList[] = [];

                  for (const order of pullingOrders) {
                    if (order.group_id) {
                      const arr = grouped.get(order.group_id) || [];
                      arr.push(order);
                      grouped.set(order.group_id, arr);
                    } else {
                      ungrouped.push(order);
                    }
                  }

                  return (
                    <div className={CARD_GRID}>
                      {Array.from(grouped.entries()).map(([groupId, groupOrders]) => (
                        <GroupCard
                          key={groupId}
                          orders={groupOrders}
                          groupType={groupOrders[0]?.shipping_type ?? 'regular'}
                          onSelect={handleOrderSelect}
                          onDelete={handleDelete}
                          onUngroup={handleUngroup}
                          onMerge={setSelectedMenuOrder}
                        />
                      ))}
                      {ungrouped.map((order) => {
                        const st = pullingShippingTypes.get(order.id) ?? 'regular';
                        // Actively-picked orders are click-only; ready orders
                        // keep their drag behavior (reclass / merge / waiting).
                        return order.status === 'active' ? (
                          <StaticOrderCard
                            key={order.id}
                            order={order}
                            shippingType={st}
                            onSelect={handleOrderSelect}
                            onDelete={handleDelete}
                            onUngroup={handleUngroup}
                            onMerge={setSelectedMenuOrder}
                          />
                        ) : (
                          <SortableOrderCard
                            key={order.id}
                            order={order}
                            shippingType={st}
                            onSelect={handleOrderSelect}
                            onDelete={handleDelete}
                            onUngroup={handleUngroup}
                            onMerge={setSelectedMenuOrder}
                          />
                        );
                      })}
                    </div>
                  );
                })()
              )}
            </div>
          )}

          {/* COMPLETED — today's orders with completion time. Auto-expands
              when the board is quiet (or completely empty, where it falls
              back to the latest completed orders with date labels). */}
          {hasCompleted && (
            <div className="border-b border-subtle">
              <button
                onClick={() => setCompletedOverride(completedExpanded ? false : true)}
                className="w-full flex items-center justify-center gap-2 py-2 md:py-3 hover:bg-content/5 transition-colors"
              >
                <span className="text-sm md:text-base font-black uppercase tracking-widest text-content/60">
                  Completed
                </span>
                <span className="text-sm text-muted/60">
                  ({completedFedex.length + completedRegular.length})
                </span>
                <ChevronDown
                  size={14}
                  className={`text-content/40 transition-transform ${
                    completedExpanded ? 'rotate-180' : ''
                  }`}
                />
              </button>
              {completedExpanded && (
                <div className="px-2 pb-3 md:px-4">
                  <CompletedZone
                    fedexOrders={completedFedex}
                    regularOrders={completedRegular}
                    showDate={completedShowsDates}
                    onSelectOrder={(orderId) => {
                      setExternalOrderId(orderId);
                      navigate('/ship');
                      onClose();
                    }}
                  />
                </div>
              )}
            </div>
          )}

          {/* Show Waiting Zone at the bottom if NOT toggled to top */}
          {!showWaitingOnTop && waitingZoneElement}
        </div>

        {/* Waiting reason prompt (drag to Waiting zone) — shared centered modal */}
        {pendingWaitingOrder && (
          <WaitingReasonModal
            listId={pendingWaitingOrder.id}
            onClose={() => setPendingWaitingOrder(null)}
            onMarked={refresh}
          />
        )}

        {orderToMerge && (
          <BoardMergeModal
            sourceOrder={orderToMerge}
            onClose={() => setOrderToMerge(null)}
            onMerge={handleMergeSelect}
          />
        )}

        {/* Reopen reason prompt (drag from Completed to a lane) */}
        {pendingReopenOrder && (
          <div
            className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-main/70 backdrop-blur-md animate-in fade-in duration-150"
            onClick={() => setPendingWaitingOrder(null)}
          >
            <div
              className="bg-surface border border-subtle rounded-2xl w-full max-w-xs shadow-2xl p-5 space-y-3 animate-in zoom-in-95 duration-150"
              onClick={(e) => e.stopPropagation()}
            >
              <p className="text-xs font-black text-content uppercase tracking-tight">
                Reopen Order #{pendingReopenOrder.order_number || '...'}?
              </p>
              <p className="text-[10px] text-muted">
                This will reopen the completed order and move it to the{' '}
                {(pendingReopenOrder.shipping_type || 'regular') === 'fedex' ? 'FedEx' : 'Regular'}{' '}
                lane.
              </p>
              <ReasonPicker
                actionType="reopen"
                selectedReason={reopenReason}
                onReasonChange={setReopenReason}
              />
              <div className="flex gap-2">
                <button
                  onClick={() => {
                    setReopenReason('');
                    setPendingReopenOrder(null);
                  }}
                  className="flex-1 p-2.5 rounded-xl text-xs font-black uppercase text-muted bg-card border border-subtle transition-all active:scale-[0.98]"
                >
                  Cancel
                </button>
                <button
                  onClick={async () => {
                    if (!reopenReason.trim() || !pendingReopenOrder) return;
                    try {
                      await reopenOrder(pendingReopenOrder.id, reopenReason.trim());
                      await supabase
                        .from('picking_lists')
                        .update({ shipping_type: pendingReopenOrder.shipping_type })
                        .eq('id', pendingReopenOrder.id);
                      toast.success('Order reopened');
                      setReopenReason('');
                      setPendingReopenOrder(null);
                      refresh();
                    } catch {
                      toast.error('Failed to reopen order');
                    }
                  }}
                  disabled={!reopenReason.trim()}
                  className="flex-1 p-2.5 rounded-xl text-xs font-black uppercase text-white bg-accent hover:bg-accent/90 disabled:opacity-40 transition-all active:scale-[0.98]"
                >
                  Reopen
                </button>
              </div>
            </div>
          </div>
        )}
        {selectedMenuOrder && (
          <OrderActionsMenuModal
            order={selectedMenuOrder}
            onClose={() => setSelectedMenuOrder(null)}
            onEditOrder={() => {
              const orderId = selectedMenuOrder.id;
              setSelectedMenuOrder(null);
              setExternalActionTrigger('edit');
              setExternalDoubleCheckId(orderId);
              setViewMode('picking');
              onClose();
            }}
            onTakePhoto={() => {
              const orderId = selectedMenuOrder.id;
              setSelectedMenuOrder(null);
              setExternalActionTrigger('photo');
              setExternalDoubleCheckId(orderId);
              setViewMode('picking');
              onClose();
            }}
            onMarkWaiting={() => {
              const order = selectedMenuOrder;
              setSelectedMenuOrder(null);
              setPendingWaitingOrder(order);
            }}
            onResumeOrder={async () => {
              const orderId = selectedMenuOrder.id;
              setSelectedMenuOrder(null);
              await unmarkWaiting.mutateAsync({ listId: orderId, action: 'resume' });
              refresh();
            }}
            onMergeOrder={() => {
              setOrderToMerge(selectedMenuOrder);
              setSelectedMenuOrder(null);
            }}
            onReopenOrder={() => {
              setPendingReopenOrder(selectedMenuOrder);
              setSelectedMenuOrder(null);
            }}
          />
        )}
      </div>
    </>
  );
};

interface OrderActionsMenuModalProps {
  order: PickingList;
  onClose: () => void;
  onEditOrder: () => void;
  onTakePhoto: () => void;
  onMarkWaiting: () => void;
  onResumeOrder: () => void;
  onMergeOrder: () => void;
  onReopenOrder: () => void;
}

const OrderActionsMenuModal: React.FC<OrderActionsMenuModalProps> = ({
  order,
  onClose,
  onEditOrder,
  onTakePhoto,
  onMarkWaiting,
  onResumeOrder,
  onMergeOrder,
  onReopenOrder,
}) => {
  const isWaiting = order.is_waiting_inventory;
  const isPastOrder = order.status === 'completed' || order.status === 'cancelled';

  return createPortal(
    <div
      className="fixed inset-0 z-[260] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-200"
      onClick={onClose}
    >
      <div
        className="bg-[#1a1a1a] border border-white/10 rounded-2xl p-5 w-full max-w-sm flex flex-col shadow-2xl animate-in zoom-in-95 duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between mb-4 shrink-0 pb-3 border-b border-white/5">
          <div>
            <h3 className="text-sm font-black text-content uppercase tracking-widest flex items-center gap-2">
              Order Options
              {!isPastOrder && (
                <div className="ml-2 scale-90 origin-left">
                  <ShippingTypeToggle
                    listId={order.id}
                    autoType={order.shipping_type as 'fedex' | 'regular' | null}
                  />
                </div>
              )}
            </h3>
            <p className="text-[10px] text-muted/70 mt-1">
              Order #{order.order_number || order.id.toString().slice(-6).toUpperCase()}
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-muted hover:text-content transition-colors rounded-lg hover:bg-content/[0.05]"
            type="button"
          >
            <X size={18} />
          </button>
        </div>

        {/* Options List */}
        <div className="space-y-1.5">
          {!isPastOrder && (
            <>
              <button
                onClick={onEditOrder}
                className="w-full flex items-center gap-3 px-4 py-3 bg-surface border border-subtle hover:bg-surface/80 transition-colors text-left rounded-xl"
              >
                <Pencil size={16} className="text-sky-400" />
                <div>
                  <div className="text-xs font-black uppercase tracking-wider text-content">
                    Edit Order
                  </div>
                  <div className="text-[9px] text-muted/70">
                    Adjust items or resolve stock conflicts
                  </div>
                </div>
              </button>

              <button
                onClick={onTakePhoto}
                className="w-full flex items-center gap-3 px-4 py-3 bg-surface border border-subtle hover:bg-surface/80 transition-colors text-left rounded-xl"
              >
                <Camera size={16} className="text-accent" />
                <div>
                  <div className="text-xs font-black uppercase tracking-wider text-content">
                    Take Photo
                  </div>
                  <div className="text-[9px] text-muted/70">Capture and upload pallet photos</div>
                </div>
              </button>

              {isWaiting ? (
                <button
                  onClick={onResumeOrder}
                  className="w-full flex items-center gap-3 px-4 py-3 bg-surface border border-subtle hover:bg-surface/80 transition-colors text-left rounded-xl"
                >
                  <Play size={16} className="text-emerald-400 animate-pulse" />
                  <div>
                    <div className="text-xs font-black uppercase tracking-wider text-content">
                      Resume Order
                    </div>
                    <div className="text-[9px] text-muted/70">Resume double check flow</div>
                  </div>
                </button>
              ) : (
                <button
                  onClick={onMarkWaiting}
                  className="w-full flex items-center gap-3 px-4 py-3 bg-surface border border-subtle hover:bg-surface/80 transition-colors text-left rounded-xl"
                >
                  <Hourglass size={16} className="text-amber-400" />
                  <div>
                    <div className="text-xs font-black uppercase tracking-wider text-content">
                      Mark as Waiting
                    </div>
                    <div className="text-[9px] text-muted/70">
                      Hold order for inventory/stock issues
                    </div>
                  </div>
                </button>
              )}
            </>
          )}

          <button
            onClick={onMergeOrder}
            className="w-full flex items-center gap-3 px-4 py-3 bg-surface border border-subtle hover:bg-surface/80 transition-colors text-left rounded-xl"
          >
            <GitMerge size={16} className="text-purple-400" />
            <div>
              <div className="text-xs font-black uppercase tracking-wider text-content">
                Merge / Combine
              </div>
              <div className="text-[9px] text-muted/70">Merge this order with another one</div>
            </div>
          </button>

          {isPastOrder && (
            <button
              onClick={onReopenOrder}
              className="w-full flex items-center gap-3 px-4 py-3 bg-surface border border-subtle hover:bg-surface/80 transition-colors text-left rounded-xl"
            >
              <Clock size={16} className="text-sky-400" />
              <div>
                <div className="text-xs font-black uppercase tracking-wider text-content">
                  Reopen Order
                </div>
                <div className="text-[9px] text-muted/70">Restore order to an active lane</div>
              </div>
            </button>
          )}
        </div>

        {/* Footer */}
        <div className="mt-4 shrink-0 flex gap-2">
          <button
            onClick={onClose}
            className="flex-1 min-h-10 rounded-xl font-black uppercase tracking-widest text-[10px] bg-surface text-muted border border-subtle transition-all hover:bg-surface/80 active:scale-[0.97]"
            type="button"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
};
