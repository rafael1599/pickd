import React from 'react';
import { useDraggable, useDroppable } from '@dnd-kit/core';
import Unlink from 'lucide-react/dist/esm/icons/unlink';
import Trash2 from 'lucide-react/dist/esm/icons/trash-2';
import ChevronDown from 'lucide-react/dist/esm/icons/chevron-down';
import type { PickingList } from '../../hooks/useDoubleCheckList';

interface GroupCardProps {
  orders: PickingList[];
  groupType: string;
  onSelect: (order: PickingList) => void;
  onDelete: (order: PickingList) => void;
  onUngroup: (order: PickingList) => void;
}

const GROUP_COLORS: Record<string, { border: string; bg: string; label: string; text: string }> = {
  fedex: { border: 'border-purple-500/30', bg: 'bg-purple-500/5', label: 'FDX GROUP', text: 'text-purple-400' },
  general: { border: 'border-sky-500/30', bg: 'bg-sky-500/5', label: 'GROUP', text: 'text-sky-400' },
};

export const GroupCard = React.memo<GroupCardProps>(({ orders, groupType, onSelect, onDelete, onUngroup }) => {
  const firstOrder = orders[0];
  if (!firstOrder) return null;

  const colors = GROUP_COLORS[groupType] ?? GROUP_COLORS.general;
  const groupId = firstOrder.group_id!;

  const draggable = useDraggable({
    id: `drag-group-${groupId}`,
    data: { order: firstOrder, shippingType: firstOrder.shipping_type ?? 'regular' },
  });
  const droppable = useDroppable({
    id: `group-${groupId}`,
    data: { order: firstOrder, shippingType: firstOrder.shipping_type ?? 'regular' },
  });

  return (
    <div
      ref={(node) => { draggable.setNodeRef(node); droppable.setNodeRef(node); }}
      style={{
        transform: draggable.transform
          ? `translate(${draggable.transform.x}px, ${draggable.transform.y}px)`
          : undefined,
        touchAction: draggable.isDragging ? 'none' : 'manipulation',
      }}
      className={`rounded-xl border-2 border-dashed ${colors.border} ${colors.bg} transition-all duration-200 ${
        droppable.isOver ? 'scale-[1.02] shadow-lg' : ''
      } ${draggable.isDragging ? 'opacity-30 scale-95' : ''}`}
      {...draggable.attributes}
      {...draggable.listeners}
    >
      {/* Group header */}
      <div className="px-2 pt-1.5 pb-0.5">
        <span className={`text-[7px] font-black uppercase tracking-widest ${colors.text}`}>
          {colors.label}
        </span>
      </div>

      {/* Stacked order numbers */}
      <div className="px-1 pb-1 space-y-0.5">
        {orders.map((order) => (
          <div
            key={order.id}
            className="flex items-center gap-1 rounded-lg hover:bg-white/5 transition-colors"
          >
            <button
              onClick={() => onSelect(order)}
              className="flex-1 flex items-center justify-between py-1 px-1.5 text-left"
            >
              <div className="text-[11px] font-black uppercase tracking-tight text-content">
                {order.source === 'pdf_import' && <span title="PDF Import" className="mr-0.5">📥</span>}
                #{order.order_number || order.id.toString().slice(-6).toUpperCase()}
              </div>
              <ChevronDown size={12} className="-rotate-90 text-subtle" />
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); onUngroup(order); }}
              className="p-0.5 text-muted hover:text-amber-500 transition-colors"
              title="Remove from group"
            >
              <Unlink size={10} />
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); onDelete(order); }}
              className="p-0.5 text-muted hover:text-red-500 transition-colors"
              title="Delete"
            >
              <Trash2 size={10} />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
});

GroupCard.displayName = 'GroupCard';
