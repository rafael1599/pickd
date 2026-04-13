import React, { useState, useMemo, useCallback } from 'react';
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
  pointerWithin,
  rectIntersection,
  type CollisionDetection,
} from '@dnd-kit/core';
// SortableContext removed — lanes use useDraggable+useDroppable, not sorting
import { useNavigate } from 'react-router-dom';
import X from 'lucide-react/dist/esm/icons/x';
import { useDoubleCheckList, type PickingList } from '../hooks/useDoubleCheckList';
import { useOrderGroups } from '../hooks/useOrderGroups';
import { useBoardLayout } from '../hooks/useBoardLayout';
import { useBoardDnD } from '../hooks/useBoardDnD';
import { useMarkWaiting } from '../hooks/useWaitingOrders';
import { useViewMode } from '../../../context/ViewModeContext';
import { usePickingSession } from '../../../context/PickingContext';
import { useConfirmation } from '../../../context/ConfirmationContext';
import { useAuth } from '../../../context/AuthContext';
import { autoClassifyShippingType } from '../../../utils/shippingClassification';
import { DroppableZone } from './board/DroppableZone';
import { SortableOrderCard, DraggableOrderCard } from './board/SortableOrderCard';
import { CompletedZone } from './board/CompletedZone';
import { ProjectsZone } from './board/ProjectsZone';
import { WaitingZone } from './board/WaitingZone';
import { GroupOrderModal } from './GroupOrderModal';
import { CrossLaneConfirmModal } from './board/CrossLaneConfirmModal';
import { ReasonPicker } from './ReasonPicker';
import { supabase } from '../../../lib/supabase';
import toast from 'react-hot-toast';

// Zone IDs
const ZONE_PRIORITY = 'zone-priority';
const ZONE_FEDEX = 'zone-fedex';
const ZONE_REGULAR = 'zone-regular';
const ZONE_PROJECTS = 'zone-projects';
const ZONE_COMPLETED = 'zone-completed';
const ZONE_WAITING = 'zone-waiting';

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

  const [waitingCollapsed, setWaitingCollapsed] = useState(true);
  const [waitingReason, setWaitingReason] = useState('');
  const [reopenReason, setReopenReason] = useState('');

  // ─── Classify orders into zones ────────────────────────────────────
  const { priorityOrders, fedexOrders, regularOrders, waitingOrders, recentCompleted } =
    useMemo(() => {
      const priority: PickingList[] = [];
      const fedex: PickingList[] = [];
      const regular: PickingList[] = [];
      const waiting: PickingList[] = [];

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

        // Priority = only needs_correction (something went wrong, fix this)
        // Lanes = ready_to_double_check + double_checking (normal flow)
        if (order.status === 'needs_correction') {
          (order as PickingList & { _shippingType?: string })._shippingType = shippingType;
          priority.push(order);
        } else {
          if (shippingType === 'fedex') fedex.push(order);
          else regular.push(order);
        }
      }

      // Recently completed: last 3 of today
      const today = new Date().toISOString().slice(0, 10);
      const recent = (completedOrders ?? [])
        .filter((o) => o.updated_at?.slice(0, 10) === today)
        .slice(0, 3);

      return {
        priorityOrders: priority,
        fedexOrders: fedex,
        regularOrders: regular,
        waitingOrders: waiting,
        recentCompleted: recent,
      };
    }, [orders, completedOrders]);

  // ─── Board layout ──────────────────────────────────────────────────
  const layout = useBoardLayout({
    priority: priorityOrders.length,
    fedex: fedexOrders.length,
    regular: regularOrders.length,
    projects: 1, // ProjectsZone manages its own data; assume non-empty for layout
    completed: recentCompleted.length,
    waiting: waitingOrders.length,
  });

  // ─── DnD sensors ──────────────────────────────────────────────────
  const pointerSensor = useSensor(PointerSensor, {
    activationConstraint: { delay: 300, tolerance: 5 },
  });
  const touchSensor = useSensor(TouchSensor, {
    activationConstraint: { delay: 300, tolerance: 5 },
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
    const cardHit = all.find((c) => !(c.id as string).startsWith('zone-') && !(c.id as string).startsWith('drag-'));
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

  // Helper to render order cards for a lane
  const renderOrderCards = (laneOrders: PickingList[], shippingType: 'fedex' | 'regular') =>
    laneOrders.map((order) => (
      <SortableOrderCard
        key={order.id}
        order={order}
        shippingType={shippingType}
        showShippingBadge={false}
        onSelect={handleOrderSelect}
        onDelete={handleDelete}
        onUngroup={handleUngroup}
      />
    ));

  // ─── Render ───────────────────────────────────────────────────────
  return (
    <div className="fixed inset-0 z-[60] flex flex-col bg-main">
      {/* Header */}
      <div className="px-4 py-3 border-b border-subtle bg-surface flex items-center justify-between shrink-0">
        <h2 className="text-lg font-black text-content uppercase tracking-tight">
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
        <div className="flex-1 overflow-y-auto min-h-0 p-3 pb-20 space-y-3">
          {/* Priority Zone — auto-populated, not a lane */}
          {priorityOrders.length > 0 && (
            <div className="md:max-w-2xl md:mx-auto">
              <DroppableZone
                id={ZONE_PRIORITY}
                label="Priority"
                labelColor="text-red-400"
                borderColor="border-red-500/30"
                bgColor="bg-red-500/5"
                bgHover="bg-red-500/10"
                count={priorityOrders.length}
                emptyMessage="No priority orders"
              >
                {priorityOrders.map((order) => (
                  <DraggableOrderCard
                    key={order.id}
                    order={order}
                    shippingType={((order as PickingList & { _shippingType?: string })._shippingType as 'fedex' | 'regular') ?? 'regular'}
                    onSelect={handleOrderSelect}
                    onDelete={handleDelete}
                    onUngroup={handleUngroup}
                  />
                ))}
              </DroppableZone>
            </div>
          )}

          {/* Main Lanes — responsive grid */}
          <div
            className="grid grid-cols-2 gap-3 md:grid-cols-4 min-h-0"
            style={{
              // Desktop: animated column sizing
              ...(typeof window !== 'undefined' && window.innerWidth >= 768
                ? {
                    gridTemplateColumns: layout.desktopGridCols,
                    transition: 'grid-template-columns 300ms ease',
                  }
                : {}),
            }}
          >
            {/* FedEx Lane */}
            <div className={`${layout.mobileFedex} md:col-span-1 min-h-0`}>
              <DroppableZone
                id={ZONE_FEDEX}
                label="FedEx"
                labelColor="text-purple-400"
                borderColor="border-purple-500/30"
                bgColor="bg-purple-500/5"
                bgHover="bg-purple-500/10"
                count={fedexOrders.length}
                className="h-full"
                emptyMessage="No FedEx orders"
              >
                {renderOrderCards(fedexOrders, 'fedex')}
              </DroppableZone>
            </div>

            {/* Regular Lane */}
            <div className={`${layout.mobileRegular} md:col-span-1 min-h-0`}>
              <DroppableZone
                id={ZONE_REGULAR}
                label="Regular"
                labelColor="text-emerald-400"
                borderColor="border-emerald-500/30"
                bgColor="bg-emerald-500/5"
                bgHover="bg-emerald-500/10"
                count={regularOrders.length}
                className="h-full"
                emptyMessage="No regular orders"
              >
                {renderOrderCards(regularOrders, 'regular')}
              </DroppableZone>
            </div>

            {/* In Progress Projects */}
            <div className={`${layout.mobileProjects} md:col-span-1 min-h-0`}>
              <DroppableZone
                id={ZONE_PROJECTS}
                disabled
                label="Projects"
                labelColor="text-indigo-400"
                borderColor="border-indigo-500/30"
                bgColor="bg-indigo-500/5"
                bgHover="bg-indigo-500/5"
                emptyMessage="No active projects"
                className="h-full"
              >
                <ProjectsZone onNavigate={() => { navigate('/projects'); onClose(); }} />
              </DroppableZone>
            </div>

            {/* Recently Completed */}
            <div className={`${layout.mobileCompleted} md:col-span-1 min-h-0`}>
              <DroppableZone
                id={ZONE_COMPLETED}
                label="Completed"
                labelColor="text-gray-400"
                borderColor="border-subtle"
                bgColor="bg-subtle/5"
                bgHover="bg-accent/5"
                count={recentCompleted.length}
                className="h-full"
                emptyMessage="No orders completed today"
              >
                <CompletedZone
                  orders={recentCompleted}
                  onSelectOrder={(orderId) => {
                    setExternalOrderId(orderId);
                    navigate('/orders');
                    onClose();
                  }}
                />
              </DroppableZone>
            </div>
          </div>

          {/* Waiting Zone — collapsible, at bottom */}
          {waitingOrders.length > 0 && (
            <div className="md:max-w-2xl md:mx-auto">
              <DroppableZone
                id={ZONE_WAITING}
                label="Waiting for Inventory"
                labelColor="text-amber-400"
                borderColor="border-amber-500/30"
                bgColor="bg-amber-500/5"
                bgHover="bg-amber-500/10"
                count={waitingOrders.length}
                collapsible
                collapsed={waitingCollapsed}
                onToggleCollapse={() => setWaitingCollapsed((v) => !v)}
                emptyMessage="No waiting orders"
              >
                <WaitingZone orders={waitingOrders} onSelect={handleOrderSelect} />
              </DroppableZone>
            </div>
          )}
        </div>

        <DragOverlay dropAnimation={null}>
          {dnd.activeOrder && (() => {
            const st = (dnd.activeOrder as unknown as Record<string, unknown>)._shippingType as string
              ?? dnd.activeOrder.shipping_type
              ?? 'regular';
            return (
              <div className="flex items-center gap-3 p-3 rounded-2xl bg-surface border-2 border-purple-500 shadow-2xl shadow-purple-500/20 opacity-95 max-w-xs">
                <div className={`w-8 h-8 rounded-xl flex items-center justify-center text-white text-[10px] font-black ${
                  st === 'fedex' ? 'bg-purple-500' : 'bg-emerald-500'
                }`}>
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
          orderNumber={dnd.pendingCrossLane.order.order_number || dnd.pendingCrossLane.order.id.slice(-6)}
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
                onClick={() => { setWaitingReason(''); dnd.cancelPending(); }}
                className="flex-1 p-2.5 rounded-xl text-xs font-black uppercase text-muted bg-card border border-subtle transition-all active:scale-[0.98]"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  if (!waitingReason.trim()) return;
                  markWaiting.mutate(
                    { listId: dnd.pendingWaiting!.order.id, reason: waitingReason.trim() },
                    { onSuccess: () => { setWaitingReason(''); dnd.setPendingWaiting(null); refresh(); } }
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
              This will reopen the completed order and move it to the {dnd.pendingReopen.targetZone === 'fedex' ? 'FedEx' : 'Regular'} lane.
            </p>
            <ReasonPicker
              actionType="reopen"
              selectedReason={reopenReason}
              onReasonChange={setReopenReason}
            />
            <div className="flex gap-2">
              <button
                onClick={() => { setReopenReason(''); dnd.cancelPending(); }}
                className="flex-1 p-2.5 rounded-xl text-xs font-black uppercase text-muted bg-card border border-subtle transition-all active:scale-[0.98]"
              >
                Cancel
              </button>
              <button
                onClick={async () => {
                  if (!reopenReason.trim() || !dnd.pendingReopen) return;
                  try {
                    await reopenOrder(dnd.pendingReopen.order.id, reopenReason.trim());
                    await supabase.from('picking_lists').update({ shipping_type: dnd.pendingReopen.targetZone }).eq('id', dnd.pendingReopen.order.id);
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
