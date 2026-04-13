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

interface CardProps {
  order: PickingList;
  shippingType: ShippingType;
  showShippingBadge?: boolean;
  onSelect: (order: PickingList) => void;
  onDelete: (order: PickingList) => void;
  onUngroup?: (order: PickingList) => void;
}

const SHIPPING_COLORS: Record<ShippingType, { badge: string; badgeText: string }> = {
  fedex: { badge: 'bg-purple-500', badgeText: 'FDX' },
  regular: { badge: 'bg-emerald-500', badgeText: 'TRK' },
};

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
    default:
      return {
        border: 'border-accent/20',
        iconBg: 'bg-accent/10 text-accent border-accent/20',
        hoverBg: 'hover:bg-accent/5',
        chevronHover: 'group-hover:text-accent',
        Icon: CheckCircle2,
      };
  }
}

// ─── Shared visual content (no DnD hooks) ────────────────────────────────────

interface OrderCardShellProps extends CardProps {
  setNodeRef: (el: HTMLElement | null) => void;
  style: React.CSSProperties;
  isDragging: boolean;
  isOver: boolean;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  attributes: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  listeners: any;
}

const OrderCardShell: React.FC<OrderCardShellProps> = ({
  order,
  shippingType,
  showShippingBadge = true,
  onSelect,
  onDelete,
  onUngroup,
  setNodeRef,
  style,
  isDragging,
  isOver,
  attributes,
  listeners,
}) => {
  const statusStyles = getStatusStyles(order.status);
  const { Icon } = statusStyles;
  const colors = SHIPPING_COLORS[shippingType];

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`flex items-center gap-0.5 pr-1 rounded-xl transition-all duration-200 group border ${
        isOver
          ? 'border-2 border-purple-500 bg-purple-500/10 scale-[1.02]'
          : statusStyles.border
      } ${statusStyles.hoverBg} ${isDragging ? 'opacity-30 scale-95 z-50' : ''}`}
      {...(attributes as React.HTMLAttributes<HTMLDivElement>)}
      {...(listeners as React.HTMLAttributes<HTMLDivElement>)}
    >
      <button
        onClick={() => onSelect(order)}
        className={`flex-1 flex items-center justify-between py-2 px-2.5 text-left ${
          order.status === 'double_checking' ? 'opacity-60' : ''
        }`}
      >
        <div className="flex items-center gap-1.5">
          {(order.status === 'needs_correction' || order.status === 'double_checking') && (
            <div className={`w-6 h-6 rounded-md flex items-center justify-center border transition-colors shrink-0 ${statusStyles.iconBg}`}>
              <Icon size={12} />
            </div>
          )}
          <div>
            <div className="text-[11px] font-black uppercase tracking-tight text-content flex items-center gap-1 flex-wrap">
              {order.source === 'pdf_import' && <span title="PDF Import">📥</span>}
              #{order.order_number || order.id.toString().slice(-6).toUpperCase()}
              {showShippingBadge && (
                <span className={`text-[7px] ${colors.badge} text-white px-1 py-0.5 rounded font-black uppercase tracking-wider`}>
                  {colors.badgeText}
                </span>
              )}
              {order.order_group && (
                <span className={`text-[7px] ${order.order_group.group_type === 'fedex' ? 'bg-purple-500' : 'bg-sky-500'} text-white px-1 py-0.5 rounded font-black uppercase tracking-wider`}>
                  {order.order_group.group_type === 'fedex' ? 'FDX' : 'GRP'}
                </span>
              )}
              {order.is_waiting_inventory && (
                <span className="text-[7px] bg-amber-500 text-white px-1 py-0.5 rounded font-black uppercase tracking-wider">WAIT</span>
              )}
              {order.is_addon && (
                <span className="text-[7px] bg-amber-500 text-white px-1 py-0.5 rounded font-black animate-pulse">ADD-ON</span>
              )}
            </div>
            <div className="text-[9px] text-muted font-bold uppercase tracking-wider mt-0.5">
              {order.status === 'needs_correction'
                ? order.profiles?.full_name ? `Picked by ${order.profiles.full_name.split(' ')[0]}` : null
                : order.status === 'double_checking'
                  ? `Checking: ${order.checker_profile?.full_name?.split(' ')[0] ?? '...'}`
                  : order.profiles?.full_name ? `Picked by ${order.profiles.full_name.split(' ')[0]}` : null}
            </div>
          </div>
        </div>
        <ChevronDown size={14} className={`-rotate-90 text-subtle ${statusStyles.chevronHover} transition-colors`} />
      </button>
      {order.group_id && onUngroup && (
        <button onClick={(e) => { e.stopPropagation(); onUngroup(order); }} className="p-1 text-muted hover:text-amber-500 transition-colors" title="Remove from group">
          <Unlink size={12} />
        </button>
      )}
      <button onClick={(e) => { e.stopPropagation(); onDelete(order); }} className="p-1 text-muted hover:text-red-500 transition-colors" title="Delete Order">
        <Trash2 size={14} />
      </button>
    </div>
  );
};

// ─── SortableOrderCard (for lane items — drag + drop target) ─────────────────

export const SortableOrderCard = React.memo<CardProps>(
  (props) => {
    const { attributes, listeners, setNodeRef, transform, transition, isDragging, isOver } =
      useSortable({ id: props.order.id, data: { order: props.order, shippingType: props.shippingType } });

    return (
      <OrderCardShell
        {...props}
        setNodeRef={setNodeRef}
        style={{
          transform: CSS.Transform.toString(transform),
          transition,
          touchAction: isDragging ? 'none' : 'manipulation',
        }}
        isDragging={isDragging}
        isOver={isOver}
        attributes={attributes}
        listeners={listeners}
      />
    );
  }
);
SortableOrderCard.displayName = 'SortableOrderCard';

// ─── DraggableOrderCard (for Priority — drag only, no drop target) ───────────

export const DraggableOrderCard = React.memo<CardProps>(
  (props) => {
    const { attributes, listeners, setNodeRef, transform, isDragging } =
      useDraggable({ id: props.order.id, data: { order: props.order, shippingType: props.shippingType } });

    return (
      <OrderCardShell
        {...props}
        setNodeRef={setNodeRef}
        style={{
          transform: transform ? `translate(${transform.x}px, ${transform.y}px)` : undefined,
          touchAction: isDragging ? 'none' : 'manipulation',
        }}
        isDragging={isDragging}
        isOver={false}
        attributes={attributes}
        listeners={listeners}
      />
    );
  }
);
DraggableOrderCard.displayName = 'DraggableOrderCard';
