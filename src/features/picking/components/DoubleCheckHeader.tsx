import { useState, useMemo, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { useScrollLock } from '../../../hooks/useScrollLock';
import {
  DndContext,
  DragOverlay,
  useDraggable,
  useDroppable,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type DragStartEvent,
  type DragEndEvent,
} from '@dnd-kit/core';
import { useDoubleCheckList, PickingList } from '../hooks/useDoubleCheckList';
import { useOrderGroups, type GroupType } from '../hooks/useOrderGroups';
import { useViewMode } from '../../../context/ViewModeContext';
import ClipboardCheck from 'lucide-react/dist/esm/icons/clipboard-check';
import ChevronDown from 'lucide-react/dist/esm/icons/chevron-down';
import CheckCircle2 from 'lucide-react/dist/esm/icons/check-circle-2';
import Trash2 from 'lucide-react/dist/esm/icons/trash-2';
import X from 'lucide-react/dist/esm/icons/x';
import Clock from 'lucide-react/dist/esm/icons/clock';
import AlertCircle from 'lucide-react/dist/esm/icons/alert-circle';
import Unlink from 'lucide-react/dist/esm/icons/unlink';
import { usePickingSession } from '../../../context/PickingContext';
import { useConfirmation } from '../../../context/ConfirmationContext';
import { GroupOrderModal } from './GroupOrderModal';
import toast from 'react-hot-toast';

// ─── Group Badge ──────────────────────────────────────────────────────────────

const GroupBadge: React.FC<{ groupType: string }> = ({ groupType }) => {
  if (groupType === 'fedex') {
    return (
      <span className="ml-2 text-[8px] bg-purple-500 text-white px-1.5 py-0.5 rounded-md font-black uppercase tracking-wider">
        FDX
      </span>
    );
  }
  return (
    <span className="ml-2 text-[8px] bg-sky-500 text-white px-1.5 py-0.5 rounded-md font-black uppercase tracking-wider">
      GRP
    </span>
  );
};

// ─── Draggable Order Card ─────────────────────────────────────────────────────

interface OrderCardProps {
  order: PickingList;
  variant: 'correction' | 'ready';
  isOverDropZone?: boolean;
  isDragging?: boolean;
  onSelect: (order: PickingList) => void;
  onDelete: (order: PickingList) => void;
  onUngroup?: (order: PickingList) => void;
}

const DraggableOrderCard: React.FC<OrderCardProps> = ({
  order,
  variant,
  isOverDropZone,
  onSelect,
  onDelete,
  onUngroup,
}) => {
  const {
    attributes,
    listeners,
    setNodeRef: setDragRef,
    isDragging,
  } = useDraggable({
    id: `drag-${order.id}`,
    data: { order },
  });

  const { setNodeRef: setDropRef, isOver } = useDroppable({
    id: `drop-${order.id}`,
    data: { order },
  });

  const isCorrection = variant === 'correction';
  const isChecking = order.status === 'double_checking';
  const showDropHighlight = isOver || isOverDropZone;

  const borderClass = showDropHighlight
    ? 'border-2 border-purple-500 bg-purple-500/10 scale-[1.02]'
    : isCorrection
      ? 'border border-amber-500/10'
      : isChecking
        ? 'border border-orange-500/10'
        : 'border border-accent/10';

  const iconBg = isCorrection
    ? 'bg-amber-500/10 text-amber-500 border-amber-500/20'
    : isChecking
      ? 'bg-orange-500/10 text-orange-500 border-orange-500/20'
      : 'bg-accent/10 text-accent border-accent/20';

  const hoverBg = isCorrection ? 'hover:bg-amber-500/5' : 'hover:bg-accent/5';
  const chevronHover = isCorrection ? 'group-hover:text-amber-500' : 'group-hover:text-accent';

  return (
    <div
      ref={(node) => {
        setDragRef(node);
        setDropRef(node);
      }}
      className={`flex items-center gap-1 pr-2 rounded-2xl ${hoverBg} transition-all duration-200 group ${borderClass} ${isDragging ? 'opacity-30 scale-95' : ''}`}
      {...attributes}
      {...listeners}
      style={{ touchAction: isDragging ? 'none' : 'manipulation' }}
    >
      <button
        onClick={() => onSelect(order)}
        className={`flex-1 flex items-center justify-between p-4 text-left ${isChecking && !isCorrection ? 'opacity-60' : ''}`}
      >
        <div className="flex items-center gap-4">
          <div
            className={`w-10 h-10 rounded-xl flex items-center justify-center border transition-colors ${iconBg}`}
          >
            {isCorrection ? (
              <AlertCircle size={20} />
            ) : isChecking ? (
              <Clock size={20} />
            ) : (
              <CheckCircle2 size={20} />
            )}
          </div>
          <div>
            <div
              className={`text-sm font-black uppercase tracking-tight ${order.order_number?.startsWith('-') ? 'text-red-500' : 'text-content'}`}
            >
              {order.source === 'pdf_import' && (
                <span title="PDF Import" className="mr-1">
                  📥
                </span>
              )}
              #{order.order_number || order.id.toString().slice(-6).toUpperCase()}
              {order.is_addon && (
                <span className="ml-2 text-[8px] bg-amber-500 text-white px-1.5 py-0.5 rounded-md border border-amber-600/20 shadow-sm animate-pulse">
                  ADD-ON
                </span>
              )}
              {order.order_group && <GroupBadge groupType={order.order_group.group_type} />}
            </div>
            <div className="text-[10px] text-muted font-bold uppercase tracking-wider">
              {isCorrection
                ? order.profiles?.full_name
                  ? `Being picked by ${order.profiles.full_name.split(' ')[0]}`
                  : null
                : isChecking
                  ? `Being checked by ${order.checker_profile?.full_name?.split(' ')[0]}`
                  : order.profiles?.full_name
                    ? `Being picked by ${order.profiles.full_name.split(' ')[0]}`
                    : null}
            </div>
          </div>
        </div>
        <ChevronDown
          size={18}
          className={`-rotate-90 text-subtle ${chevronHover} transition-colors`}
        />
      </button>
      {order.group_id && onUngroup && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onUngroup(order);
          }}
          className="p-2 text-muted hover:text-amber-500 transition-colors"
          title="Remove from group"
        >
          <Unlink size={16} />
        </button>
      )}
      <button
        onClick={(e) => {
          e.stopPropagation();
          onDelete(order);
        }}
        className="p-3 text-muted hover:text-red-500 transition-colors"
        title="Delete Order"
      >
        <Trash2 size={18} />
      </button>
    </div>
  );
};

// ─── Drag Overlay (ghost card while dragging) ─────────────────────────────────

const DragOverlayCard: React.FC<{ order: PickingList }> = ({ order }) => (
  <div className="flex items-center gap-4 p-4 rounded-2xl bg-surface border-2 border-purple-500 shadow-2xl shadow-purple-500/20 opacity-90 w-[calc(100vw-4rem)] max-w-lg">
    <div className="w-10 h-10 rounded-xl bg-purple-500/10 flex items-center justify-center text-purple-400 border border-purple-500/20">
      <CheckCircle2 size={20} />
    </div>
    <div>
      <div className="text-sm font-black uppercase tracking-tight text-content">
        #{order.order_number || order.id.toString().slice(-6).toUpperCase()}
      </div>
      <div className="text-[10px] text-purple-400 font-bold uppercase tracking-wider">
        Drop on another order to group
      </div>
    </div>
  </div>
);

// ─── Group Container ──────────────────────────────────────────────────────────

interface GroupContainerProps {
  groupType: string;
  children: React.ReactNode;
}

const GroupContainer: React.FC<GroupContainerProps> = ({ groupType, children }) => {
  const borderColor = groupType === 'fedex' ? 'border-purple-500/30' : 'border-sky-500/30';
  const bgColor = groupType === 'fedex' ? 'bg-purple-500/5' : 'bg-sky-500/5';
  const labelColor = groupType === 'fedex' ? 'text-purple-400' : 'text-sky-400';
  const label = groupType === 'fedex' ? 'FEDEX GROUP' : 'GROUP';

  return (
    <div className={`rounded-2xl border-2 border-dashed ${borderColor} ${bgColor} p-2 space-y-1`}>
      <p className={`px-2 text-[8px] font-black ${labelColor} uppercase tracking-widest`}>
        {label}
      </p>
      {children}
    </div>
  );
};

// ─── Main Component ───────────────────────────────────────────────────────────

export const DoubleCheckHeader = () => {
  const { orders, completedOrders, readyCount, correctionCount, refresh } = useDoubleCheckList();
  const { createGroup, addToGroup, removeFromGroup } = useOrderGroups();
  const navigate = useNavigate();
  const { setExternalDoubleCheckId, setExternalOrderId, setViewMode } = useViewMode();
  const { cartItems, sessionMode, deleteList } = usePickingSession();
  const { showConfirmation } = useConfirmation();
  const [isOpen, setIsOpen] = useState(false);
  useScrollLock(isOpen, () => setIsOpen(false));
  const [activeOrder, setActiveOrder] = useState<PickingList | null>(null);
  const [pendingMerge, setPendingMerge] = useState<{
    source: PickingList;
    target: PickingList;
  } | null>(null);

  const totalActions = readyCount + correctionCount;

  // Sensors: touch needs delay to avoid conflicting with scroll/tap
  const pointerSensor = useSensor(PointerSensor, {
    activationConstraint: { delay: 300, tolerance: 5 },
  });
  const touchSensor = useSensor(TouchSensor, {
    activationConstraint: { delay: 300, tolerance: 5 },
  });
  const sensors = useSensors(pointerSensor, touchSensor);

  // Group orders by group_id for visual rendering
  const { groupedReadyOrders, ungroupedReadyOrders, groups } = useMemo(() => {
    const readyOrders = orders.filter(
      (o) => o.status === 'ready_to_double_check' || o.status === 'double_checking'
    );

    const grouped = new Map<string, PickingList[]>();
    const ungrouped: PickingList[] = [];
    const groupMap = new Map<string, string>(); // groupId -> groupType

    for (const order of readyOrders) {
      if (order.group_id) {
        const existing = grouped.get(order.group_id) || [];
        existing.push(order);
        grouped.set(order.group_id, existing);
        if (order.order_group) {
          groupMap.set(order.group_id, order.order_group.group_type);
        }
      } else {
        ungrouped.push(order);
      }
    }

    return {
      groupedReadyOrders: grouped,
      ungroupedReadyOrders: ungrouped,
      groups: groupMap,
    };
  }, [orders]);

  const handleOrderSelect = useCallback(
    (order: PickingList) => {
      if (cartItems.length > 0 && sessionMode === 'picking') {
        toast.error('Please finish or clear your active picking session first.', {
          icon: '🛒',
          duration: 4000,
        });
        return;
      }
      setExternalDoubleCheckId(order.id.toString());
      setViewMode('picking');
      setIsOpen(false);
    },
    [cartItems.length, sessionMode, setExternalDoubleCheckId, setViewMode]
  );

  const handleDelete = useCallback(
    (order: PickingList) => {
      showConfirmation(
        'Delete Order',
        'Are you sure you want to delete this order permanently? This action cannot be undone.',
        () => deleteList(order.id.toString()),
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
      const targetOrder = over.data.current?.order as PickingList | undefined;

      if (!sourceOrder || !targetOrder || sourceOrder.id === targetOrder.id) return;

      // If target already has a group, add source to that group directly
      if (targetOrder.group_id) {
        addToGroup(targetOrder.group_id, sourceOrder.id).then(() => refresh());
        return;
      }

      // If source already has a group, add target to that group
      if (sourceOrder.group_id) {
        addToGroup(sourceOrder.group_id, targetOrder.id).then(() => refresh());
        return;
      }

      // Neither has a group — show modal to create one
      setPendingMerge({ source: sourceOrder, target: targetOrder });
    },
    [addToGroup, refresh]
  );

  const handleGroupConfirm = useCallback(
    async (type: GroupType) => {
      if (!pendingMerge) return;
      await createGroup(type, [pendingMerge.source.id, pendingMerge.target.id]);
      setPendingMerge(null);
      refresh();
    },
    [pendingMerge, createGroup, refresh]
  );

  return (
    <div className="relative">
      <button
        onClick={() => {
          const nextState = !isOpen;
          setIsOpen(nextState);
          if (nextState) refresh();
        }}
        className={`flex items-center gap-2 px-3 py-1.5 rounded-full transition-all active:scale-95 relative ${
          totalActions > 0
            ? 'bg-accent/10 text-accent border border-accent/30 shadow-lg shadow-accent/5'
            : 'bg-surface border border-subtle text-muted opacity-60'
        }`}
      >
        <div className="relative">
          <ClipboardCheck size={18} className={totalActions > 0 ? 'text-accent' : ''} />
          {totalActions > 0 && (
            <span className="absolute -top-2.5 -right-2.5 w-4 h-4 bg-red-500 text-white text-[9px] font-black rounded-full flex items-center justify-center border-2 border-card animate-bounce">
              {totalActions}
            </span>
          )}
        </div>
        <span className="text-xs font-black uppercase tracking-widest hidden sm:block">
          Verification
        </span>
        <ChevronDown
          size={14}
          className={`transition-transform duration-300 hidden sm:block ${isOpen ? 'rotate-180' : ''}`}
        />
      </button>

      {isOpen &&
        createPortal(
          <div
            className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/60 backdrop-blur-md animate-in fade-in duration-200"
            onClick={() => setIsOpen(false)}
          >
            <div
              className="bg-surface border border-subtle rounded-3xl w-full max-w-lg shadow-2xl overflow-hidden scale-100 animate-in zoom-in-95 duration-200 flex flex-col max-h-[80vh]"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="px-6 py-4 border-b border-subtle bg-main/50 flex items-center justify-between">
                <h3 className="text-xl font-black text-content uppercase tracking-tight">
                  Verification Queue
                </h3>
                <button
                  onClick={() => setIsOpen(false)}
                  className="p-2 -mr-2 text-muted hover:text-content transition-colors"
                >
                  <X className="w-6 h-6" />
                </button>
              </div>

              <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
                <div className="overflow-y-auto flex-1 pb-6">
                  {/* Needs Correction Section */}
                  {correctionCount > 0 && (
                    <div className="p-4">
                      <p className="px-2 py-1 text-[10px] font-black text-amber-500 uppercase tracking-widest mb-2">
                        Action Required
                      </p>
                      <div className="space-y-1">
                        {orders
                          .filter((o) => o.status === 'needs_correction')
                          .map((order) => (
                            <DraggableOrderCard
                              key={order.id}
                              order={order}
                              variant="correction"
                              onSelect={handleOrderSelect}
                              onDelete={handleDelete}
                              onUngroup={handleUngroup}
                            />
                          ))}
                      </div>
                    </div>
                  )}

                  {/* Ready for Double Check Section */}
                  <div className="p-4">
                    <p className="px-2 py-1 text-[10px] font-black text-accent uppercase tracking-widest mb-2">
                      Ready to Verify
                    </p>
                    <div className="space-y-2">
                      {/* Grouped orders */}
                      {Array.from(groupedReadyOrders.entries()).map(([groupId, groupOrders]) => (
                        <GroupContainer key={groupId} groupType={groups.get(groupId) || 'general'}>
                          {groupOrders.map((order) => (
                            <DraggableOrderCard
                              key={order.id}
                              order={order}
                              variant="ready"
                              onSelect={handleOrderSelect}
                              onDelete={handleDelete}
                              onUngroup={handleUngroup}
                            />
                          ))}
                        </GroupContainer>
                      ))}

                      {/* Ungrouped orders */}
                      {ungroupedReadyOrders.map((order) => (
                        <DraggableOrderCard
                          key={order.id}
                          order={order}
                          variant="ready"
                          onSelect={handleOrderSelect}
                          onDelete={handleDelete}
                        />
                      ))}

                      {readyCount === 0 &&
                        orders.filter((o) => o.status === 'double_checking').length === 0 && (
                          <div className="p-12 text-center">
                            <CheckCircle2
                              size={40}
                              className="mx-auto mb-4 text-muted opacity-20"
                            />
                            <p className="text-xs text-muted font-bold uppercase tracking-widest italic">
                              No orders waiting
                            </p>
                          </div>
                        )}
                    </div>
                  </div>

                  {/* Recently Completed Section */}
                  {completedOrders.length > 0 && (
                    <div className="p-4 border-t border-subtle/50 bg-subtle/5">
                      <p className="px-2 py-1 text-[10px] font-black text-muted uppercase tracking-widest mb-2">
                        Recently Completed
                      </p>
                      <div className="grid grid-cols-2 gap-2">
                        {completedOrders.map((order) => (
                          <button
                            key={order.id}
                            onClick={() => {
                              setExternalOrderId(order.id);
                              navigate('/orders');
                              setIsOpen(false);
                            }}
                            className="flex items-center gap-2 p-2 rounded-xl bg-card border border-subtle hover:border-accent/20 transition-all text-left"
                          >
                            <div className="w-8 h-8 rounded-lg bg-main flex items-center justify-center text-muted shrink-0">
                              <CheckCircle2 size={14} />
                            </div>
                            <div className="min-w-0">
                              <div className="text-[10px] font-black text-content uppercase tracking-tight truncate">
                                #{order.order_number || order.id.toString().slice(-6).toUpperCase()}
                              </div>
                              <div className="text-[8px] text-muted font-bold uppercase tracking-tighter truncate">
                                {order.customer?.name || 'Customer'}
                              </div>
                            </div>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                <DragOverlay dropAnimation={null}>
                  {activeOrder && <DragOverlayCard order={activeOrder} />}
                </DragOverlay>
              </DndContext>
            </div>
          </div>,
          document.body
        )}

      {/* Group Order Modal */}
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
