import React from 'react';
import { useDraggable, useDroppable } from '@dnd-kit/core';
import CheckCircle2 from 'lucide-react/dist/esm/icons/check-circle-2';
import Clock from 'lucide-react/dist/esm/icons/clock';
import AlertCircle from 'lucide-react/dist/esm/icons/alert-circle';
import Trash2 from 'lucide-react/dist/esm/icons/trash-2';
import Unlink from 'lucide-react/dist/esm/icons/unlink';
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

/** Sum of pickingQty across the order's items, falling back to total_units. */
export function getOrderUnits(order: PickingList): number {
  const items = order.items;
  if (Array.isArray(items) && items.length > 0) {
    const sum = items.reduce(
      (acc, i) => acc + (((i as Record<string, unknown>).pickingQty as number) || 0),
      0
    );
    if (sum > 0) return sum;
  }
  return order.total_units ?? 0;
}

const SHIPPING_COLORS: Record<ShippingType, { stripe: string; badge: string; badgeText: string }> =
  {
    fedex: { stripe: 'bg-purple-500/70', badge: 'bg-purple-500', badgeText: 'FDX' },
    regular: { stripe: 'bg-emerald-500/70', badge: 'bg-emerald-500', badgeText: 'TRK' },
  };

function getStatusStyles(status: string) {
  switch (status) {
    case 'needs_correction':
      return {
        border: 'border-amber-500/30',
        icon: 'text-amber-500',
        hoverBg: 'hover:bg-amber-500/5',
        Icon: AlertCircle,
      };
    case 'double_checking':
      return {
        border: 'border-orange-500/30',
        icon: 'text-orange-500',
        hoverBg: 'hover:bg-orange-500/5',
        Icon: Clock,
      };
    default:
      return {
        border: 'border-subtle',
        icon: 'text-accent',
        hoverBg: 'hover:bg-accent/5',
        Icon: CheckCircle2,
      };
  }
}

/** First name of whoever is on the order right now: the checker while the
 *  order is being double-checked, otherwise the picker who pulled it. */
export function getWorkerLabel(order: PickingList): string | null {
  const name =
    order.status === 'double_checking'
      ? order.checker_profile?.full_name
      : order.profiles?.full_name;
  const first = name?.trim().split(' ')[0];
  if (!first) return null;
  return order.status === 'double_checking' ? `✓ ${first}` : first;
}

// ─── Shared visual content (no DnD hooks) ────────────────────────────────────
// Big-board tile: readable from across the warehouse floor. Exactly three
// data points — order #, pallets, worker — sized fluidly with the viewport.

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
  const worker = getWorkerLabel(order);
  const showStatusIcon = order.status === 'needs_correction' || order.status === 'double_checking';

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`relative flex flex-col rounded-2xl overflow-hidden bg-card transition-all duration-200 group border ${
        isOver ? 'border-2 border-purple-500 bg-purple-500/10 scale-[1.02]' : statusStyles.border
      } ${statusStyles.hoverBg} ${isDragging ? 'opacity-30 scale-95 z-50' : ''}`}
      {...(attributes as React.HTMLAttributes<HTMLDivElement>)}
      {...(listeners as React.HTMLAttributes<HTMLDivElement>)}
    >
      {showShippingBadge && <div className={`h-1.5 shrink-0 ${colors.stripe}`} />}
      {/* Actions live in normal flow (right column), never absolutely
          positioned — on narrow tiles an overlay was covering the text. */}
      <div className="flex-1 flex items-start min-w-0">
        <button
          onClick={() => onSelect(order)}
          className={`flex-1 text-left px-3 py-2.5 md:px-4 md:py-3 flex flex-col gap-1 min-w-0 ${
            order.status === 'double_checking' ? 'opacity-70' : ''
          }`}
        >
          <div className="flex items-center gap-2 min-w-0">
            {showStatusIcon && (
              <Icon
                size={22}
                className={`shrink-0 ${statusStyles.icon} md:w-7 md:h-7`}
                aria-label={order.status}
              />
            )}
            <span className="text-[clamp(1.6rem,3vw,4rem)] leading-none font-black uppercase tracking-tight text-content truncate">
              {order.source === 'pdf_import' && <span title="PDF Import">📥</span>}#
              {order.order_number || order.id.toString().slice(-6).toUpperCase()}
            </span>
            {order.is_addon && (
              <span className="shrink-0 text-[clamp(0.6rem,1vw,1rem)] bg-amber-500 text-white px-1.5 py-0.5 rounded font-black animate-pulse">
                ADD-ON
              </span>
            )}
          </div>
          <div className="flex items-baseline gap-3 min-w-0">
            <span
              className={`text-[clamp(1.15rem,2vw,2.5rem)] leading-tight font-black uppercase ${
                typeof order.pallets_qty === 'number' && order.pallets_qty > 0
                  ? 'text-sky-400'
                  : 'text-muted/40'
              }`}
            >
              {typeof order.pallets_qty === 'number' && order.pallets_qty > 0
                ? `${order.pallets_qty} PLT`
                : '— PLT'}
            </span>
            {worker && (
              <span className="text-[clamp(1.05rem,1.8vw,2.25rem)] leading-tight font-bold uppercase tracking-wide text-muted truncate">
                {worker}
              </span>
            )}
          </div>
        </button>
        <div className="flex items-center shrink-0 pt-1.5 pr-1">
          {order.group_id && onUngroup && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onUngroup(order);
              }}
              className="p-2 text-muted/60 hover:text-amber-500 transition-colors"
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
            className="p-2 text-muted/60 hover:text-red-500 transition-colors"
            title="Delete Order"
          >
            <Trash2 size={16} />
          </button>
        </div>
      </div>
    </div>
  );
};

// ─── SortableOrderCard (for lane items — drag + drop target, NO sorting) ─────
// Uses useDraggable + useDroppable separately to enable drag-out and drop-on
// without the sorting/reorder behavior that confuses users.

export const SortableOrderCard = React.memo<CardProps>((props) => {
  const draggable = useDraggable({
    id: `drag-${props.order.id}`,
    data: { order: props.order, shippingType: props.shippingType },
  });
  const droppable = useDroppable({
    id: props.order.id,
    data: { order: props.order, shippingType: props.shippingType },
  });

  return (
    <OrderCardShell
      {...props}
      setNodeRef={(node) => {
        draggable.setNodeRef(node);
        droppable.setNodeRef(node);
      }}
      style={{
        transform: draggable.transform
          ? `translate(${draggable.transform.x}px, ${draggable.transform.y}px)`
          : undefined,
        touchAction: 'none',
      }}
      isDragging={draggable.isDragging}
      isOver={droppable.isOver}
      attributes={draggable.attributes}
      listeners={draggable.listeners}
    />
  );
});
SortableOrderCard.displayName = 'SortableOrderCard';

// ─── DraggableOrderCard (for Priority — drag only, no drop target) ───────────

export const DraggableOrderCard = React.memo<CardProps>((props) => {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: props.order.id,
    data: { order: props.order, shippingType: props.shippingType },
  });

  return (
    <OrderCardShell
      {...props}
      setNodeRef={setNodeRef}
      style={{
        transform: transform ? `translate(${transform.x}px, ${transform.y}px)` : undefined,
        touchAction: 'none',
      }}
      isDragging={isDragging}
      isOver={false}
      attributes={attributes}
      listeners={listeners}
    />
  );
});
DraggableOrderCard.displayName = 'DraggableOrderCard';

// ─── StaticOrderCard (for actively-picked orders in Pulling — no DnD) ────────
// Orders with status 'active' are still being pulled; moving them around the
// board makes no sense, so the tile is click-only.

export const StaticOrderCard = React.memo<CardProps>((props) => (
  <OrderCardShell
    {...props}
    setNodeRef={() => {}}
    style={{}}
    isDragging={false}
    isOver={false}
    attributes={{}}
    listeners={{}}
  />
));
StaticOrderCard.displayName = 'StaticOrderCard';
