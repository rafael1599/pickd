import React, { useState, useMemo, useCallback } from 'react';
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
  closestCenter,
  type DragStartEvent,
  type DragEndEvent,
} from '@dnd-kit/core';
import X from 'lucide-react/dist/esm/icons/x';
import { useDoubleCheckList, type PickingList } from '../hooks/useDoubleCheckList';
import { useOrderGroups } from '../hooks/useOrderGroups';
import { useBoardLayout } from '../hooks/useBoardLayout';
import { useViewMode } from '../../../context/ViewModeContext';
import { usePickingSession } from '../../../context/PickingContext';
import { useConfirmation } from '../../../context/ConfirmationContext';
import { autoClassifyShippingType } from '../../../utils/shippingClassification';
import { DroppableZone } from './board/DroppableZone';
import { SortableOrderCard } from './board/SortableOrderCard';
import { CompletedZone } from './board/CompletedZone';
import { ProjectsZone } from './board/ProjectsZone';
import { WaitingZone } from './board/WaitingZone';
import { GroupOrderModal } from './GroupOrderModal';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
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
  const { createGroup, addToGroup, removeFromGroup } = useOrderGroups();
  const { setExternalDoubleCheckId, setExternalOrderId, setViewMode } = useViewMode();
  const { cartItems, sessionMode, deleteList } = usePickingSession();
  const { showConfirmation } = useConfirmation();

  const [activeOrder, setActiveOrder] = useState<PickingList | null>(null);
  const [pendingMerge, setPendingMerge] = useState<{
    source: PickingList;
    target: PickingList;
  } | null>(null);
  const [waitingCollapsed, setWaitingCollapsed] = useState(true);

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

        const isInPriority =
          order.status === 'needs_correction' || order.status === 'ready_to_double_check';

        if (isInPriority) {
          // Priority orders carry their shipping type for coloring
          (order as PickingList & { _shippingType?: string })._shippingType = shippingType;
          priority.push(order);
        } else {
          // double_checking orders go to their lane
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

  // ─── DnD handlers ─────────────────────────────────────────────────
  const handleDragStart = useCallback((event: DragStartEvent) => {
    const order = event.active.data.current?.order as PickingList | undefined;
    if (order) setActiveOrder(order);
  }, []);

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      setActiveOrder(null);
      const { active, over } = event;
      if (!over) return;

      const sourceOrder = active.data.current?.order as PickingList | undefined;
      if (!sourceOrder) return;

      const overId = over.id as string;

      // Drop on a zone → reclassify
      if (overId.startsWith('zone-')) {
        // TODO: implement zone reclassification (Fase 3)
        return;
      }

      // Drop on another order → merge
      const targetOrder = over.data.current?.order as PickingList | undefined;
      if (!targetOrder || sourceOrder.id === targetOrder.id) return;

      if (targetOrder.group_id) {
        addToGroup(targetOrder.group_id, sourceOrder.id).then(() => refresh());
      } else if (sourceOrder.group_id) {
        addToGroup(sourceOrder.group_id, targetOrder.id).then(() => refresh());
      } else {
        setPendingMerge({ source: sourceOrder, target: targetOrder });
      }
    },
    [addToGroup, refresh]
  );

  // ─── Helpers ──────────────────────────────────────────────────────
  const handleOrderSelect = useCallback(
    (order: PickingList) => {
      if (cartItems.length > 0 && sessionMode === 'picking') {
        toast.error('Finish or clear your active picking session first.', { icon: '🛒' });
        return;
      }
      setExternalDoubleCheckId(order.id);
      setViewMode('picking');
      onClose();
    },
    [cartItems.length, sessionMode, setExternalDoubleCheckId, setViewMode, onClose]
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

  const handleGroupConfirm = useCallback(
    async (type: 'fedex' | 'general') => {
      if (!pendingMerge) return;
      await createGroup(type, [pendingMerge.source.id, pendingMerge.target.id]);
      setPendingMerge(null);
      refresh();
    },
    [pendingMerge, createGroup, refresh]
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
        collisionDetection={closestCenter}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
      >
        <div className="flex-1 overflow-y-auto min-h-0 p-3 space-y-3">
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
                <SortableContext items={priorityOrders.map(o => o.id)} strategy={verticalListSortingStrategy}>
                  {priorityOrders.map((order) => (
                    <SortableOrderCard
                      key={order.id}
                      order={order}
                      shippingType={((order as PickingList & { _shippingType?: string })._shippingType as 'fedex' | 'regular') ?? 'regular'}
                      onSelect={handleOrderSelect}
                      onDelete={handleDelete}
                      onUngroup={handleUngroup}
                    />
                  ))}
                </SortableContext>
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
                <SortableContext items={fedexOrders.map(o => o.id)} strategy={verticalListSortingStrategy}>
                  {renderOrderCards(fedexOrders, 'fedex')}
                </SortableContext>
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
                <SortableContext items={regularOrders.map(o => o.id)} strategy={verticalListSortingStrategy}>
                  {renderOrderCards(regularOrders, 'regular')}
                </SortableContext>
              </DroppableZone>
            </div>

            {/* In Progress Projects */}
            <div className={`${layout.mobileProjects} md:col-span-1 min-h-0`}>
              <DroppableZone
                id={ZONE_PROJECTS}
                disabled
                label="In Progress"
                labelColor="text-indigo-400"
                borderColor="border-indigo-500/30"
                bgColor="bg-indigo-500/5"
                bgHover="bg-indigo-500/5"
                emptyMessage="No projects in progress"
                className="h-full"
              >
                <ProjectsZone />
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
          {activeOrder && (
            <div className="flex items-center gap-4 p-4 rounded-2xl bg-surface border-2 border-purple-500 shadow-2xl shadow-purple-500/20 opacity-90 w-[calc(100vw-4rem)] max-w-sm">
              <div className="text-sm font-black uppercase tracking-tight text-content">
                #{activeOrder.order_number || activeOrder.id.slice(-6).toUpperCase()}
              </div>
              <div className="text-[10px] text-purple-400 font-bold uppercase tracking-wider">
                Drop to reclassify or merge
              </div>
            </div>
          )}
        </DragOverlay>
      </DndContext>

      {pendingMerge && (
        <GroupOrderModal
          sourceOrder={pendingMerge.source}
          targetOrder={pendingMerge.target}
          onConfirm={handleGroupConfirm}
          onCancel={() => setPendingMerge(null)}
        />
      )}
    </div>
  );
};
