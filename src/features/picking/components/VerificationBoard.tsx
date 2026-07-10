import React, { useState, useMemo, useCallback } from 'react';
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
  useDroppable,
  pointerWithin,
  rectIntersection,
  type CollisionDetection,
} from '@dnd-kit/core';
import ChevronDown from 'lucide-react/dist/esm/icons/chevron-down';
// SortableContext removed — lanes use useDraggable+useDroppable, not sorting
import { useNavigate } from 'react-router-dom';
import X from 'lucide-react/dist/esm/icons/x';
import { useDoubleCheckList, type PickingList } from '../hooks/useDoubleCheckList';
import { useOrderGroups } from '../hooks/useOrderGroups';
import { useBoardDnD } from '../hooks/useBoardDnD';
import { useViewMode } from '../../../context/ViewModeContext';
import { usePickingSession } from '../../../context/PickingContext';
import { useConfirmation } from '../../../context/ConfirmationContext';
import { useAuth } from '../../../context/AuthContext';
import { autoClassifyShippingType } from '../../../utils/shippingClassification';
import { SortableOrderCard, DraggableOrderCard, StaticOrderCard } from './board/SortableOrderCard';
import { CompletedZone } from './board/CompletedZone';
import { WaitingZone } from './board/WaitingZone';
import { GroupCard } from './board/GroupCard';
import { GroupOrderModal } from './GroupOrderModal';
import { CrossLaneConfirmModal } from './board/CrossLaneConfirmModal';
import { WaitingReasonModal } from './WaitingReasonModal';
import { ReasonPicker } from './ReasonPicker';
import { supabase } from '../../../lib/supabase';
import toast from 'react-hot-toast';

// Zone IDs (must stay in sync with useBoardDnD)
const ZONE_PRIORITY = 'zone-priority';
const ZONE_FEDEX = 'zone-fedex';
const ZONE_REGULAR = 'zone-regular';
const ZONE_WAITING = 'zone-waiting';
// The "Pulling" queue (DB status ready_to_double_check) — the zone id keeps
// its historical name so useBoardDnD stays untouched.
const ZONE_READY = 'zone-ready';

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
const DropZone: React.FC<{
  id: string;
  className?: string;
  children: React.ReactNode;
}> = ({ id, className = '', children }) => {
  const { setNodeRef, isOver } = useDroppable({ id });
  return (
    <div
      ref={setNodeRef}
      className={`${className} ${isOver ? 'bg-accent/5' : ''} transition-colors`}
    >
      {children}
    </div>
  );
};

interface VerificationBoardProps {
  onClose: () => void;
}

export const VerificationBoard: React.FC<VerificationBoardProps> = ({ onClose }) => {
  const { orders, completedOrders, refresh } = useDoubleCheckList();
  const { removeFromGroup } = useOrderGroups();
  const { setExternalDoubleCheckId, setExternalOrderId, setViewMode } = useViewMode();
  const { cartItems, sessionMode, deleteList, reopenOrder, activeListId } = usePickingSession();
  const { showConfirmation } = useConfirmation();
  const { isAdmin } = useAuth();
  const navigate = useNavigate();

  // DnD logic — all zone reclassification, merge, prompts
  const dnd = useBoardDnD(isAdmin, refresh);

  const [waitingCollapsed, setWaitingCollapsed] = useState(false);
  const [reopenReason, setReopenReason] = useState('');
  // Manual toggle for Completed Today. null = follow the auto rule
  // (open when the board is quiet, collapsed when it's busy).
  const [completedOverride, setCompletedOverride] = useState<boolean | null>(null);

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

    for (const order of orders) {
      if (order.is_waiting_inventory) {
        waiting.push(order);
        continue;
      }

      // Determine shipping type: persisted or auto-classified
      const shippingType =
        order.shipping_type ??
        autoClassifyShippingType(
          order.items?.map((i) => ({
            sku: i.sku,
            pickingQty: (i as Record<string, unknown>).pickingQty as number,
          })) ?? [],
          {} // No weight data available here — falls back to count-only rule
        );

      // "Pulling" — every order of the day still being worked: actively
      // picked (status 'active') and finished-picking-awaiting-verification
      // (status 'ready_to_double_check'). One unified zone.
      if (order.status === 'active' || order.status === 'ready_to_double_check') {
        pulling.push(order);
        pullingShipTypes.set(order.id, shippingType === 'fedex' ? 'fedex' : 'regular');
        continue;
      }

      // Remaining statuses (needs_correction / double_checking) go to their
      // lane. needs_correction shows the ⚠️ icon in-card.
      if (shippingType === 'fedex') fedex.push(order);
      else regular.push(order);
    }

    // Oldest first (pick up what's been waiting longest).
    pulling.sort(
      (a, b) => new Date(a.updated_at ?? 0).getTime() - new Date(b.updated_at ?? 0).getTime()
    );

    // Classify completed orders
    const allCompletedFedex: PickingList[] = [];
    const allCompletedRegular: PickingList[] = [];
    for (const order of completedOrders ?? []) {
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

    const today = new Date().toISOString().slice(0, 10);
    const todayFedex = allCompletedFedex.filter((o) => o.updated_at?.slice(0, 10) === today);
    const todayRegular = allCompletedRegular.filter((o) => o.updated_at?.slice(0, 10) === today);

    const hasAnyToday = todayFedex.length > 0 || todayRegular.length > 0;
    const showsDates = !hasAnyToday;

    const fedexDone = hasAnyToday
      ? todayFedex.slice(0, COMPLETED_SIDE_LIMIT)
      : allCompletedFedex.slice(0, COMPLETED_SIDE_LIMIT);
    const regularDone = hasAnyToday
      ? todayRegular.slice(0, COMPLETED_SIDE_LIMIT)
      : allCompletedRegular.slice(0, COMPLETED_SIDE_LIMIT);

    return {
      priorityOrders: priority,
      fedexOrders: fedex,
      regularOrders: regular,
      waitingOrders: waiting,
      pullingOrders: pulling,
      pullingShippingTypes: pullingShipTypes,
      completedFedex: fedexDone,
      completedRegular: regularDone,
      completedShowsDates: showsDates,
      priorityShippingTypes: priorityShipTypes,
    };
  }, [orders, completedOrders]);

  const activeTotal =
    priorityOrders.length + fedexOrders.length + regularOrders.length + pullingOrders.length;
  const boardIsEmpty = activeTotal === 0;
  // While a drag is in progress every drop target must exist, even if the
  // zone is otherwise hidden for being empty.
  const isDraggingSomething = !!dnd.activeOrder;
  const completedExpanded = boardIsEmpty
    ? true
    : (completedOverride ?? activeTotal <= COMPLETED_AUTO_OPEN_MAX);
  const hasCompleted = completedFedex.length > 0 || completedRegular.length > 0;

  // ─── DnD sensors ──────────────────────────────────────────────────
  const pointerSensor = useSensor(PointerSensor, {
    activationConstraint: { distance: 10 },
  });
  const touchSensor = useSensor(TouchSensor, {
    activationConstraint: { delay: 150, tolerance: 20 },
  });
  const sensors = useSensors(pointerSensor, touchSensor);

  // Custom collision: pointerWithin for both zones and items.
  // When pointer is over an ORDER CARD, return the card (for merge).
  // When pointer is over a ZONE but not a card, return the zone (for reclassify).
  // This enables: drag to empty zone = reclassify, drag onto order = merge.
  const collisionDetection: CollisionDetection = useCallback((args) => {
    // pointerWithin: detects all droppables the pointer is inside of
    const pw = pointerWithin(args);
    // rectIntersection: detects all droppables the drag overlay intersects with
    const ri = rectIntersection(args);
    // Merge both sets, dedupe by id
    const seen = new Set<string | number>();
    const all = [...pw, ...ri].filter((c) => {
      if (seen.has(c.id)) return false;
      seen.add(c.id);
      return true;
    });
    if (all.length === 0) return [];
    // Prefer card-level droppable (for merge) over zone-level (for reclassify)
    const cardHit = all.find(
      (c) => !(c.id as string).startsWith('zone-') && !(c.id as string).startsWith('drag-')
    );
    if (cardHit) return [cardHit];
    // Fall back to zone
    const zoneHit = all.find((c) => (c.id as string).startsWith('zone-'));
    if (zoneHit) return [zoneHit];
    return [all[0]];
  }, []);

  // DnD handlers come from useBoardDnD hook

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
          />
        ))}
      </div>
    );
  };

  const showPulling = pullingOrders.length > 0 || isDraggingSomething;
  const showWaiting = waitingOrders.length > 0 || isDraggingSomething;

  // ─── Render ───────────────────────────────────────────────────────
  return (
    <>
      {/* z-[110]: above the bottom nav (z-100) so the board is a full takeover.
          Internal modals (GroupOrder z-150, CrossLane/WaitingReason z-200) stay on top. */}
      <div className="fixed inset-0 z-[110] flex flex-col bg-main">
        {/* Header */}
        <div className="px-3 py-2 md:px-5 md:py-3 border-b border-subtle bg-surface flex items-center justify-center relative shrink-0">
          <h2 className="text-base md:text-xl lg:text-xl font-black text-content uppercase tracking-tight text-center">
            Verification Board
          </h2>
          <button
            onClick={onClose}
            className="absolute right-3 md:right-5 p-2 text-muted hover:text-content transition-colors"
          >
            <X className="w-6 h-6" />
          </button>
        </div>

        <DndContext
          sensors={sensors}
          collisionDetection={collisionDetection}
          onDragStart={dnd.handleDragStart}
          onDragEnd={dnd.handleDragEnd}
        >
          {/* Full device width — no max-w cap; tiles scale with the viewport. */}
          <div className="flex-1 overflow-y-auto min-h-0 pb-20 w-full">
            {/* Priority — auto-populated, top of the board (rare). */}
            {priorityOrders.length > 0 && (
              <DropZone
                id={ZONE_PRIORITY}
                className="border-b border-subtle px-2 py-2 md:px-4 md:py-3"
              >
                <div className="flex items-center justify-center gap-2 mb-2 md:mb-3">
                  <span className="text-sm md:text-base font-black uppercase tracking-widest text-red-400">
                    Priority
                  </span>
                  <span className="text-sm text-muted/60">({priorityOrders.length})</span>
                </div>
                <div className={CARD_GRID}>
                  {priorityOrders.map((order) => (
                    <DraggableOrderCard
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
              </DropZone>
            )}

            {/* FEDEX | REGULAR lanes (needs_correction / double_checking).
              Empty lanes are hidden — unless a drag is in progress, when both
              drop targets must be reachable. A lone lane takes the full width. */}
            {/* FEDEX | REGULAR lanes (needs_correction / double_checking).
              Both lanes are always shown side-by-side. */}
            <div className="grid grid-cols-2 divide-x divide-subtle border-b border-subtle">
              <DropZone id={ZONE_FEDEX} className="bg-purple-500/[0.08] min-h-[44px]">
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
              </DropZone>
              <DropZone id={ZONE_REGULAR} className="bg-emerald-500/[0.08] min-h-[44px]">
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
              </DropZone>
            </div>

            {/* PULLING — every order of the day still being worked (actively
              picked + finished picking, awaiting verification). Full-width
              responsive grid, no truncation: the board should look full.
              Dropping here keeps the historical semantics (mark as ready). */}
            {showPulling && (
              <DropZone
                id={ZONE_READY}
                className="border-b border-subtle px-2 py-2 md:px-4 md:py-3"
              >
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
                  <div className={CARD_GRID}>
                    {pullingOrders.map((order) => {
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
                        />
                      ) : (
                        <SortableOrderCard
                          key={order.id}
                          order={order}
                          shippingType={st}
                          onSelect={handleOrderSelect}
                          onDelete={handleDelete}
                          onUngroup={handleUngroup}
                        />
                      );
                    })}
                  </div>
                )}
              </DropZone>
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
                    {completedShowsDates ? 'Recently Completed' : 'Completed Today'}
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

            {/* WAITING FOR INVENTORY — parked orders, bottom of the board.
              Hidden when empty (except mid-drag, so the drop target exists). */}
            {showWaiting && (
              <DropZone id={ZONE_WAITING} className="border-b border-subtle">
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
                      <WaitingZone orders={waitingOrders} onSelect={handleOrderSelect} />
                    ) : (
                      <div className="text-center text-xs text-muted/40 italic py-1">
                        Drop here → waiting for inventory
                      </div>
                    )}
                  </div>
                )}
              </DropZone>
            )}
          </div>

          <DragOverlay dropAnimation={null}>
            {dnd.activeOrder &&
              (() => {
                const st =
                  priorityShippingTypes.get(dnd.activeOrder.id) ??
                  dnd.activeOrder.shipping_type ??
                  'regular';
                return (
                  <div className="flex items-center gap-3 p-3 rounded-2xl bg-surface border-2 border-purple-500 shadow-2xl shadow-purple-500/20 opacity-95 max-w-xs">
                    <div
                      className={`w-8 h-8 rounded-xl flex items-center justify-center text-white text-[10px] font-black ${
                        st === 'fedex' ? 'bg-purple-500' : 'bg-emerald-500'
                      }`}
                    >
                      {st === 'fedex' ? 'FDX' : 'TRK'}
                    </div>
                    <div>
                      <div className="text-xs font-black uppercase tracking-tight text-content">
                        #
                        {dnd.activeOrder.order_number || dnd.activeOrder.id.slice(-6).toUpperCase()}
                      </div>
                      <div className="text-[9px] text-muted font-bold uppercase tracking-wider">
                        Drag to reclassify or merge
                      </div>
                    </div>
                  </div>
                );
              })()}
          </DragOverlay>
        </DndContext>

        {/* Group merge modal */}
        {dnd.pendingMerge && (
          <GroupOrderModal
            sourceOrder={dnd.pendingMerge.source}
            targetOrder={dnd.pendingMerge.target}
            joinExisting={!!dnd.pendingMerge.joinGroupId}
            onConfirm={dnd.confirmMerge}
            onCancel={dnd.cancelPending}
          />
        )}

        {/* Cross-lane confirmation modal */}
        {dnd.pendingCrossLane && (
          <CrossLaneConfirmModal
            orderNumber={
              dnd.pendingCrossLane.order.order_number || dnd.pendingCrossLane.order.id.slice(-6)
            }
            fromType={dnd.pendingCrossLane.fromType}
            toType={dnd.pendingCrossLane.toType}
            onConfirm={dnd.confirmCrossLane}
            onCancel={dnd.cancelPending}
          />
        )}

        {/* Waiting reason prompt (drag to Waiting zone) — shared centered modal */}
        {dnd.pendingWaiting && (
          <WaitingReasonModal
            listId={dnd.pendingWaiting.order.id}
            onClose={dnd.cancelPending}
            onMarked={refresh}
          />
        )}

        {/* Reopen reason prompt (drag from Completed to a lane) */}
        {dnd.pendingReopen && (
          <div
            className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-main/70 backdrop-blur-md animate-in fade-in duration-150"
            onClick={dnd.cancelPending}
          >
            <div
              className="bg-surface border border-subtle rounded-2xl w-full max-w-xs shadow-2xl p-5 space-y-3 animate-in zoom-in-95 duration-150"
              onClick={(e) => e.stopPropagation()}
            >
              <p className="text-xs font-black text-content uppercase tracking-tight">
                Reopen Order #{dnd.pendingReopen.order.order_number || '...'}?
              </p>
              <p className="text-[10px] text-muted">
                This will reopen the completed order and move it to the{' '}
                {dnd.pendingReopen.targetZone === 'fedex' ? 'FedEx' : 'Regular'} lane.
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
                    dnd.cancelPending();
                  }}
                  className="flex-1 p-2.5 rounded-xl text-xs font-black uppercase text-muted bg-card border border-subtle transition-all active:scale-[0.98]"
                >
                  Cancel
                </button>
                <button
                  onClick={async () => {
                    if (!reopenReason.trim() || !dnd.pendingReopen) return;
                    try {
                      await reopenOrder(dnd.pendingReopen.order.id, reopenReason.trim());
                      await supabase
                        .from('picking_lists')
                        .update({ shipping_type: dnd.pendingReopen.targetZone })
                        .eq('id', dnd.pendingReopen.order.id);
                      toast.success('Order reopened');
                      setReopenReason('');
                      dnd.setPendingReopen(null);
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
      </div>
    </>
  );
};
