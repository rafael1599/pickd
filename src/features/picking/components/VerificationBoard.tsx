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
import { useMarkWaiting } from '../hooks/useWaitingOrders';
import { useViewMode } from '../../../context/ViewModeContext';
import { usePickingSession } from '../../../context/PickingContext';
import { useConfirmation } from '../../../context/ConfirmationContext';
import { useAuth } from '../../../context/AuthContext';
import { autoClassifyShippingType } from '../../../utils/shippingClassification';
import { SortableOrderCard, DraggableOrderCard } from './board/SortableOrderCard';
import { CompletedZone } from './board/CompletedZone';
import { ProjectsZone } from './board/ProjectsZone';
import { WaitingZone } from './board/WaitingZone';
import { GroupCard } from './board/GroupCard';
import { GroupOrderModal } from './GroupOrderModal';
import { CrossLaneConfirmModal } from './board/CrossLaneConfirmModal';
import { ReasonPicker } from './ReasonPicker';
import { supabase } from '../../../lib/supabase';
import toast from 'react-hot-toast';

// Zone IDs (must stay in sync with useBoardDnD)
const ZONE_PRIORITY = 'zone-priority';
const ZONE_FEDEX = 'zone-fedex';
const ZONE_REGULAR = 'zone-regular';
const ZONE_WAITING = 'zone-waiting';
// "Ready to double-check" queue, distinct from Waiting-for-Inventory.
const ZONE_READY = 'zone-ready';
const READY_VISIBLE_COUNT = 2; // per side (FDX / TRK) before "Show N more"

// Lightweight drop target wrapper. Replaces the chunky <DroppableZone> card
// look with a transparent drop region — line-based separators handle the
// visual structure now.
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
  const markWaiting = useMarkWaiting();

  // DnD logic — all zone reclassification, merge, prompts
  const dnd = useBoardDnD(isAdmin, refresh);

  const [waitingCollapsed, setWaitingCollapsed] = useState(false);
  const [waitingReason, setWaitingReason] = useState('');
  const [reopenReason, setReopenReason] = useState('');
  const [readyExpanded, setReadyExpanded] = useState(false);
  const [completedCollapsed, setCompletedCollapsed] = useState(true);

  // ─── Classify orders into zones ────────────────────────────────────
  const {
    priorityOrders,
    fedexOrders,
    regularOrders,
    waitingOrders,
    readyOrders,
    readyFdxOrders,
    readyTrkOrders,
    fedexCompleted,
    regularCompleted,
    priorityShippingTypes,
  } = useMemo(() => {
    const priorityShipTypes = new Map<string, string>();
    const readyShipTypes = new Map<string, 'fedex' | 'regular'>();
    const priority: PickingList[] = [];
    const fedex: PickingList[] = [];
    const regular: PickingList[] = [];
    const waiting: PickingList[] = [];
    const ready: PickingList[] = [];

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

      // ready_to_double_check → goes to the "Waiting" queue at the bottom,
      // not to the FedEx/Regular lanes. The lane badge (FDX/TRK) is preserved
      // so the verifier still knows the category.
      if (order.status === 'ready_to_double_check') {
        ready.push(order);
        readyShipTypes.set(order.id, shippingType === 'fedex' ? 'fedex' : 'regular');
        continue;
      }

      // All other active orders go to their lane (FedEx/Regular).
      // needs_correction orders show ⚠️ triangle in their lane — no separate Priority zone.
      if (shippingType === 'fedex') fedex.push(order);
      else regular.push(order);
    }

    // Oldest first (the verifier should pick up what's been waiting longest).
    ready.sort(
      (a, b) => new Date(a.updated_at ?? 0).getTime() - new Date(b.updated_at ?? 0).getTime()
    );

    // Split Ready into FDX vs TRK columns so the section can be rendered as
    // two side-by-side lists.
    const readyFdx = ready.filter((o) => readyShipTypes.get(o.id) === 'fedex');
    const readyTrk = ready.filter((o) => readyShipTypes.get(o.id) !== 'fedex');

    // Recently completed today, split by carrier. Falls back to
    // autoClassifyShippingType when shipping_type is NULL — older orders
    // (pre-idea-055 or completed before the auto-persist landed) wouldn't
    // appear under the right side otherwise.
    const today = new Date().toISOString().slice(0, 10);
    const recent = (completedOrders ?? []).filter((o) => o.updated_at?.slice(0, 10) === today);
    const completedShipType = (o: PickingList): 'fedex' | 'regular' =>
      o.shipping_type === 'fedex' || o.shipping_type === 'regular'
        ? (o.shipping_type as 'fedex' | 'regular')
        : autoClassifyShippingType(
            o.items?.map((i) => ({
              sku: i.sku,
              pickingQty: (i as Record<string, unknown>).pickingQty as number,
            })) ?? [],
            {}
          );
    const fedexCompleted = recent.filter((o) => completedShipType(o) === 'fedex');
    const regularCompleted = recent.filter((o) => completedShipType(o) !== 'fedex');

    return {
      priorityOrders: priority,
      fedexOrders: fedex,
      regularOrders: regular,
      waitingOrders: waiting,
      readyOrders: ready,
      readyFdxOrders: readyFdx,
      readyTrkOrders: readyTrk,
      readyShippingTypes: readyShipTypes,
      recentCompleted: recent,
      fedexCompleted,
      regularCompleted,
      priorityShippingTypes: priorityShipTypes,
    };
  }, [orders, completedOrders]);

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
      if (activeListId && cartItems.length > 0 && sessionMode === 'picking') {
        toast.error('Finish or clear your active picking session first.', { icon: '🛒' });
        return;
      }
      setExternalDoubleCheckId(order.id);
      setViewMode('picking');
      onClose();
    },
    [activeListId, cartItems.length, sessionMode, setExternalDoubleCheckId, setViewMode, onClose]
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
      <>
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
      </>
    );
  };

  // ─── Render ───────────────────────────────────────────────────────
  return (
    <div className="fixed inset-0 z-[60] flex flex-col bg-main">
      {/* Header */}
      <div className="px-3 py-2 md:px-5 md:py-3 border-b border-subtle bg-surface flex items-center justify-between shrink-0">
        <h2 className="text-base md:text-lg lg:text-xl font-black text-content uppercase tracking-tight">
          Verification Board
        </h2>
        <button
          onClick={onClose}
          className="p-2 -mr-2 text-muted hover:text-content transition-colors"
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
        <div className="flex-1 overflow-y-auto min-h-0 pb-20 max-w-6xl w-full mx-auto">
          {/* Priority — auto-populated, top of the board (rare, only when
              the queue computes priority candidates; today's classifier
              keeps this empty by design but the drop target stays so the
              flow is reachable). */}
          {priorityOrders.length > 0 && (
            <DropZone
              id={ZONE_PRIORITY}
              className="border-b border-subtle px-2 py-2 md:px-4 md:py-3"
            >
              <div className="flex items-center justify-center gap-2 mb-2 md:mb-3">
                <span className="text-[10px] md:text-xs lg:text-sm font-black uppercase tracking-widest text-red-400">
                  Priority
                </span>
                <span className="text-[10px] md:text-xs text-muted/60">
                  ({priorityOrders.length})
                </span>
              </div>
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
            </DropZone>
          )}

          {/* FEDEX | REGULAR active lanes — minimalist: no text labels,
              just a 3px color stripe at the top + a faint background tint
              per column. The vertical divider between them frames the
              split. Drop targets unchanged (ZONE_FEDEX / ZONE_REGULAR). */}
          <div className="grid grid-cols-2 divide-x divide-subtle border-b border-subtle">
            {/* FEDEX */}
            <DropZone
              id={ZONE_FEDEX}
              className="bg-purple-500/[0.03] min-h-[44px] md:min-h-[64px] lg:min-h-[80px]"
            >
              <div className="h-[3px] md:h-[4px] bg-purple-500/60" />
              <div className="px-2 py-2 md:px-4 md:py-3 lg:px-5 lg:py-4">
                {fedexOrders.length > 0 ? (
                  renderOrderCards(fedexOrders, 'fedex')
                ) : (
                  <div className="text-center text-[9px] md:text-[10px] lg:text-xs text-purple-400/40 italic">
                    No active FedEx orders
                  </div>
                )}
              </div>
            </DropZone>

            {/* REGULAR */}
            <DropZone
              id={ZONE_REGULAR}
              className="bg-emerald-500/[0.03] min-h-[44px] md:min-h-[64px] lg:min-h-[80px]"
            >
              <div className="h-[3px] md:h-[4px] bg-emerald-500/60" />
              <div className="px-2 py-2 md:px-4 md:py-3 lg:px-5 lg:py-4">
                {regularOrders.length > 0 ? (
                  renderOrderCards(regularOrders, 'regular')
                ) : (
                  <div className="text-center text-[9px] md:text-[10px] lg:text-xs text-emerald-400/40 italic">
                    No active Regular orders
                  </div>
                )}
              </div>
            </DropZone>
          </div>

          {/* READY TO DOUBLE-CHECK — split into FDX | TRK columns sharing
              one global "Show N more" toggle. Drop on either side reclasses
              shipping_type via the existing CrossLaneConfirmModal AND marks
              ready_to_double_check (handled in useBoardDnD). */}
          <DropZone id={ZONE_READY} className="border-b border-subtle px-2 py-2 md:px-4 md:py-3">
            <div className="flex items-center justify-center gap-2 mb-2 md:mb-3">
              <span className="text-[10px] md:text-xs lg:text-sm font-black uppercase tracking-widest text-sky-400">
                Ready to Double-Check
              </span>
              {readyOrders.length > 0 && (
                <span className="text-[10px] md:text-xs text-muted/60">({readyOrders.length})</span>
              )}
            </div>
            {readyOrders.length === 0 ? (
              <div className="text-center text-[9px] md:text-[10px] lg:text-xs text-muted/40 italic">
                Drag orders here when they are ready for double-check
              </div>
            ) : (
              <div className="grid grid-cols-2 divide-x divide-subtle/60">
                {/* FDX side — minimalist (color stripe + tint, no label) */}
                <div className="bg-purple-500/[0.03]">
                  <div className="h-[2px] bg-purple-500/50" />
                  <div className="px-2 py-2 md:px-3">
                    {readyFdxOrders.length === 0 ? (
                      <div className="text-center text-[9px] md:text-[10px] text-purple-400/30 py-1">
                        —
                      </div>
                    ) : (
                      (readyExpanded
                        ? readyFdxOrders
                        : readyFdxOrders.slice(0, READY_VISIBLE_COUNT)
                      ).map((order) => (
                        <SortableOrderCard
                          key={order.id}
                          order={order}
                          shippingType="fedex"
                          showShippingBadge={false}
                          onSelect={handleOrderSelect}
                          onDelete={handleDelete}
                          onUngroup={handleUngroup}
                        />
                      ))
                    )}
                  </div>
                </div>
                {/* TRK side — minimalist (color stripe + tint, no label) */}
                <div className="bg-emerald-500/[0.03]">
                  <div className="h-[2px] bg-emerald-500/50" />
                  <div className="px-2 py-2 md:px-3">
                    {readyTrkOrders.length === 0 ? (
                      <div className="text-center text-[9px] md:text-[10px] text-emerald-400/30 py-1">
                        —
                      </div>
                    ) : (
                      (readyExpanded
                        ? readyTrkOrders
                        : readyTrkOrders.slice(0, READY_VISIBLE_COUNT)
                      ).map((order) => (
                        <SortableOrderCard
                          key={order.id}
                          order={order}
                          shippingType="regular"
                          showShippingBadge={false}
                          onSelect={handleOrderSelect}
                          onDelete={handleDelete}
                          onUngroup={handleUngroup}
                        />
                      ))
                    )}
                  </div>
                </div>
              </div>
            )}
            {readyOrders.length > READY_VISIBLE_COUNT * 2 && (
              <div className="flex justify-center mt-2 md:mt-3">
                <button
                  onClick={() => setReadyExpanded((v) => !v)}
                  className="px-4 py-1.5 text-[10px] md:text-xs font-black uppercase tracking-widest text-sky-400 hover:text-sky-300 border border-dashed border-sky-500/30 rounded-full"
                >
                  {readyExpanded
                    ? 'Show less'
                    : `Show ${readyOrders.length - READY_VISIBLE_COUNT * 2} more`}
                </button>
              </div>
            )}
          </DropZone>

          {/* WAITING FOR INVENTORY — collapsable, always-visible drop target.
              Open by default so the empty-state ("Drag an order here…") guides
              first-time use. */}
          <DropZone id={ZONE_WAITING} className="border-b border-subtle">
            <button
              onClick={() => setWaitingCollapsed((v) => !v)}
              className="w-full flex items-center justify-center gap-2 py-2 md:py-3 hover:bg-amber-500/5 transition-colors"
            >
              <span className="text-[10px] md:text-xs lg:text-sm font-black uppercase tracking-widest text-amber-400">
                Waiting for Inventory
              </span>
              {waitingOrders.length > 0 && (
                <span className="text-[10px] md:text-xs text-muted/60">
                  ({waitingOrders.length})
                </span>
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
                  <div className="text-center text-[9px] md:text-[10px] lg:text-xs text-muted/40 italic py-1">
                    Drag an order here to flag it as waiting for inventory
                  </div>
                )}
              </div>
            )}
          </DropZone>

          {/* COMPLETED TODAY — full-width, collapsable. Reference info,
              not action — sits below Waiting for Inventory so it doesn't
              compete with the active queue. FDX | TRK split mirrors the
              Ready-to-Double-Check pattern for consistency. */}
          {(fedexCompleted.length > 0 || regularCompleted.length > 0) && (
            <div className="border-b border-subtle">
              <button
                onClick={() => setCompletedCollapsed((v) => !v)}
                className="w-full flex items-center justify-center gap-2 py-2 md:py-3 hover:bg-content/5 transition-colors"
              >
                <span className="text-[10px] md:text-xs lg:text-sm font-black uppercase tracking-widest text-content/60">
                  Completed Today
                </span>
                <span className="text-[10px] md:text-xs text-muted/60">
                  ({fedexCompleted.length + regularCompleted.length})
                </span>
                <ChevronDown
                  size={14}
                  className={`text-content/40 transition-transform ${
                    completedCollapsed ? '' : 'rotate-180'
                  }`}
                />
              </button>
              {!completedCollapsed && (
                <div className="grid grid-cols-2 divide-x divide-subtle/60 pb-2 md:pb-3">
                  <div className="bg-purple-500/[0.03]">
                    <div className="h-[2px] bg-purple-500/50" />
                    <div className="px-2 py-2 md:px-3">
                      {fedexCompleted.length === 0 ? (
                        <div className="text-center text-[9px] md:text-[10px] text-purple-400/30 py-1">
                          —
                        </div>
                      ) : (
                        <CompletedZone
                          orders={fedexCompleted}
                          onSelectOrder={(orderId) => {
                            setExternalOrderId(orderId);
                            navigate('/orders');
                            onClose();
                          }}
                        />
                      )}
                    </div>
                  </div>
                  <div className="bg-emerald-500/[0.03]">
                    <div className="h-[2px] bg-emerald-500/50" />
                    <div className="px-2 py-2 md:px-3">
                      {regularCompleted.length === 0 ? (
                        <div className="text-center text-[9px] md:text-[10px] text-emerald-400/30 py-1">
                          —
                        </div>
                      ) : (
                        <CompletedZone
                          orders={regularCompleted}
                          onSelectOrder={(orderId) => {
                            setExternalOrderId(orderId);
                            navigate('/orders');
                            onClose();
                          }}
                        />
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* PROJECTS — read-only context, at the very bottom */}
          <div className="px-2 py-2 md:px-4 md:py-3">
            <div className="flex items-center justify-center gap-2 mb-2 md:mb-3">
              <span className="text-[10px] md:text-xs lg:text-sm font-black uppercase tracking-widest text-indigo-400">
                Projects
              </span>
            </div>
            <ProjectsZone
              onNavigate={() => {
                navigate('/projects');
                onClose();
              }}
            />
          </div>
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
                      #{dnd.activeOrder.order_number || dnd.activeOrder.id.slice(-6).toUpperCase()}
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

      {/* Waiting reason prompt (drag to Waiting zone) */}
      {dnd.pendingWaiting && (
        <div
          className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-main/70 backdrop-blur-md animate-in fade-in duration-150"
          onClick={dnd.cancelPending}
        >
          <div
            className="bg-surface border border-amber-500/30 rounded-2xl w-full max-w-xs shadow-2xl p-5 space-y-3 animate-in zoom-in-95 duration-150"
            onClick={(e) => e.stopPropagation()}
          >
            <p className="text-xs font-black text-amber-500 uppercase tracking-tight">
              Why is this order waiting?
            </p>
            <ReasonPicker
              actionType="waiting"
              selectedReason={waitingReason}
              onReasonChange={setWaitingReason}
            />
            <div className="flex gap-2">
              <button
                onClick={() => {
                  setWaitingReason('');
                  dnd.cancelPending();
                }}
                className="flex-1 p-2.5 rounded-xl text-xs font-black uppercase text-muted bg-card border border-subtle transition-all active:scale-[0.98]"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  if (!waitingReason.trim()) return;
                  markWaiting.mutate(
                    { listId: dnd.pendingWaiting!.order.id, reason: waitingReason.trim() },
                    {
                      onSuccess: () => {
                        setWaitingReason('');
                        dnd.setPendingWaiting(null);
                        refresh();
                      },
                    }
                  );
                }}
                disabled={!waitingReason.trim() || markWaiting.isPending}
                className="flex-1 p-2.5 rounded-xl text-xs font-black uppercase text-white bg-amber-500 hover:bg-amber-600 disabled:opacity-40 transition-all active:scale-[0.98]"
              >
                {markWaiting.isPending ? 'Marking...' : 'Confirm'}
              </button>
            </div>
          </div>
        </div>
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
  );
};
