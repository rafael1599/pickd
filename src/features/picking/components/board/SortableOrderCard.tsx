import React from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { useDraggable } from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';
import CheckCircle2 from 'lucide-react/dist/esm/icons/check-circle-2';
import Clock from 'lucide-react/dist/esm/icons/clock';
import AlertCircle from 'lucide-react/dist/esm/icons/alert-circle';
import Trash2 from 'lucide-react/dist/esm/icons/trash-2';
import Unlink from 'lucide-react/dist/esm/icons/unlink';
import ChevronDown from 'lucide-react/dist/esm/icons/chevron-down';
import type { PickingList } from '../../hooks/useDoubleCheckList';

type ShippingType = 'fedex' | 'regular';

interface SortableOrderCardProps {
  order: PickingList;
  shippingType: ShippingType;
  draggableOnly?: boolean; // true = useDraggable (Priority cards), false = useSortable (lane cards)
  onSelect: (order: PickingList) => void;
  onDelete: (order: PickingList) => void;
  onUngroup?: (order: PickingList) => void;
}

// Shipping type color schemes
const SHIPPING_COLORS: Record<ShippingType, { badge: string; badgeText: string }> = {
  fedex: { badge: 'bg-purple-500', badgeText: 'FDX' },
  regular: { badge: 'bg-emerald-500', badgeText: 'TRK' },
};

// Status-based styling
function getStatusStyles(status: string) {
  switch (status) {
    case 'needs_correction':
      return {
        border: 'border-amber-500/20',
        iconBg: 'bg-amber-500/10 text-amber-500 border-amber-500/20',
        hoverBg: 'hover:bg-amber-500/5',
        chevronHover: 'group-hover:text-amber-500',
        Icon: AlertCircle,
      };
    case 'double_checking':
      return {
        border: 'border-orange-500/20',
        iconBg: 'bg-orange-500/10 text-orange-500 border-orange-500/20',
        hoverBg: 'hover:bg-orange-500/5',
        chevronHover: 'group-hover:text-orange-500',
        Icon: Clock,
      };
    default: // ready_to_double_check, completed, etc
      return {
        border: 'border-accent/20',
        iconBg: 'bg-accent/10 text-accent border-accent/20',
        hoverBg: 'hover:bg-accent/5',
        chevronHover: 'group-hover:text-accent',
        Icon: CheckCircle2,
      };
  }
}

export const SortableOrderCard = React.memo<SortableOrderCardProps>(
  ({ order, shippingType, draggableOnly = false, onSelect, onDelete, onUngroup }) => {
    // Priority cards use useDraggable (drag OUT only, no drop target).
    // Lane cards use useSortable (drag + drop for sorting/merging).
    const sortable = useSortable({
      id: order.id,
      data: { order, shippingType },
      disabled: draggableOnly,
    });
    const draggable = useDraggable({
      id: order.id,
      data: { order, shippingType },
      disabled: !draggableOnly,
    });

    const active = draggableOnly ? draggable : sortable;
    const setNodeRef = draggableOnly ? draggable.setNodeRef : sortable.setNodeRef;
    const isDragging = draggableOnly ? draggable.isDragging : sortable.isDragging;
    const isOver = draggableOnly ? false : sortable.isOver;

    const style = {
      transform: CSS.Transform.toString(
        draggableOnly
          ? draggable.transform ? { ...draggable.transform, scaleX: 1, scaleY: 1 } : null
          : sortable.transform
      ),
      transition: draggableOnly ? undefined : sortable.transition,
      touchAction: isDragging ? ('none' as const) : ('manipulation' as const),
    };

    const statusStyles = getStatusStyles(order.status);
    const { Icon } = statusStyles;
    const colors = SHIPPING_COLORS[shippingType];

    return (
      <div
        ref={setNodeRef}
        style={style}
        className={`flex items-center gap-1 pr-2 rounded-2xl transition-all duration-200 group border ${
          isOver
            ? 'border-2 border-purple-500 bg-purple-500/10 scale-[1.02]'
            : statusStyles.border
        } ${statusStyles.hoverBg} ${isDragging ? 'opacity-30 scale-95 z-50' : ''}`}
        {...active.attributes}
        {...active.listeners}
      >
        <button
          onClick={() => onSelect(order)}
          className={`flex-1 flex items-center justify-between p-3 text-left ${
            order.status === 'double_checking' ? 'opacity-60' : ''
          }`}
        >
          <div className="flex items-center gap-3">
            <div
              className={`w-9 h-9 rounded-xl flex items-center justify-center border transition-colors ${statusStyles.iconBg}`}
            >
              <Icon size={18} />
            </div>
            <div>
              <div className="text-xs font-black uppercase tracking-tight text-content flex items-center gap-1.5 flex-wrap">
                {order.source === 'pdf_import' && <span title="PDF Import">📥</span>}
                #{order.order_number || order.id.toString().slice(-6).toUpperCase()}

                {/* Shipping type badge */}
                <span
                  className={`text-[7px] ${colors.badge} text-white px-1 py-0.5 rounded font-black uppercase tracking-wider`}
                >
                  {colors.badgeText}
                </span>

                {/* Group badge */}
                {order.order_group && (
                  <span
                    className={`text-[7px] ${
                      order.order_group.group_type === 'fedex' ? 'bg-purple-500' : 'bg-sky-500'
                    } text-white px-1 py-0.5 rounded font-black uppercase tracking-wider`}
                  >
                    {order.order_group.group_type === 'fedex' ? 'FDX' : 'GRP'}
                  </span>
                )}

                {/* Waiting badge */}
                {order.is_waiting_inventory && (
                  <span className="text-[7px] bg-amber-500 text-white px-1 py-0.5 rounded font-black uppercase tracking-wider">
                    WAIT
                  </span>
                )}

                {/* Add-on badge */}
                {order.is_addon && (
                  <span className="text-[7px] bg-amber-500 text-white px-1 py-0.5 rounded font-black animate-pulse">
                    ADD-ON
                  </span>
                )}
              </div>
              <div className="text-[9px] text-muted font-bold uppercase tracking-wider mt-0.5">
                {order.status === 'needs_correction'
                  ? order.profiles?.full_name
                    ? `Picked by ${order.profiles.full_name.split(' ')[0]}`
                    : null
                  : order.status === 'double_checking'
                    ? `Checking: ${order.checker_profile?.full_name?.split(' ')[0] ?? '...'}`
                    : order.profiles?.full_name
                      ? `Picked by ${order.profiles.full_name.split(' ')[0]}`
                      : null}
              </div>
            </div>
          </div>
          <ChevronDown
            size={16}
            className={`-rotate-90 text-subtle ${statusStyles.chevronHover} transition-colors`}
          />
        </button>

        {/* Ungroup button */}
        {order.group_id && onUngroup && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onUngroup(order);
            }}
            className="p-1.5 text-muted hover:text-amber-500 transition-colors"
            title="Remove from group"
          >
            <Unlink size={14} />
          </button>
        )}

        {/* Delete button */}
        <button
          onClick={(e) => {
            e.stopPropagation();
            onDelete(order);
          }}
          className="p-2 text-muted hover:text-red-500 transition-colors"
          title="Delete Order"
        >
          <Trash2 size={16} />
        </button>
      </div>
    );
  },
);

SortableOrderCard.displayName = 'SortableOrderCard';
