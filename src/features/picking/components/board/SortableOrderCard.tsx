import React, { createContext, useContext } from 'react';
import { useDraggable, useDroppable } from '@dnd-kit/core';
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
  /** Latest order note text (already resolved upstream — see useLatestNotesByList).
   *  Rendered in red on the card so pickers see it without opening the order. */
  latestNote?: string | null;
  onSelect: (order: PickingList) => void;
  onDelete: (order: PickingList) => void;
  onUngroup?: (order: PickingList) => void;
}

/**
 * Map of list_id → latest note message, provided once at the board level so
 * every card can surface its newest note in red without each card running its
 * own query. Defaults to an empty map when no provider is present.
 */
const LatestNotesContext = createContext<Record<string, string>>({});

export const LatestNotesProvider = LatestNotesContext.Provider;

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
  latestNote,
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
  const units = getOrderUnits(order);
  const notesByList = useContext(LatestNotesContext);
  const resolvedNote = latestNote ?? notesByList[order.id];
  const trimmedNote = resolvedNote?.trim();
  const notePreview =
    trimmedNote && trimmedNote.length > 60 ? `${trimmedNote.slice(0, 60)}…` : trimmedNote;

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`flex items-center gap-0.5 pr-1 rounded-xl transition-all duration-200 group border ${
        isOver ? 'border-2 border-purple-500 bg-purple-500/10 scale-[1.02]' : statusStyles.border
      } ${statusStyles.hoverBg} ${isDragging ? 'opacity-30 scale-95 z-50' : ''}`}
      {...(attributes as React.HTMLAttributes<HTMLDivElement>)}
      {...(listeners as React.HTMLAttributes<HTMLDivElement>)}
    >
      <button
        onClick={() => onSelect(order)}
        className={`flex-1 flex items-center justify-between py-3 px-3 text-left ${
          order.status === 'double_checking' ? 'opacity-60' : ''
        }`}
      >
        <div className="flex items-center gap-2">
          {(order.status === 'needs_correction' || order.status === 'double_checking') && (
            <div
              className={`w-9 h-9 rounded-lg flex items-center justify-center border transition-colors shrink-0 ${statusStyles.iconBg}`}
            >
              <Icon size={18} />
            </div>
          )}
          <div>
            <div className="text-lg font-black uppercase tracking-tight text-content flex items-center gap-1.5 flex-wrap">
              {order.source === 'pdf_import' && <span title="PDF Import">📥</span>}#
              {order.order_number || order.id.toString().slice(-6).toUpperCase()}
              {showShippingBadge && (
                <span
                  className={`text-[10px] ${colors.badge} text-white px-1.5 py-0.5 rounded font-black uppercase tracking-wider`}
                >
                  {colors.badgeText}
                </span>
              )}
              {order.is_waiting_inventory && (
                <span className="text-[10px] bg-amber-500 text-white px-1.5 py-0.5 rounded font-black uppercase tracking-wider">
                  WAIT
                </span>
              )}
              {order.is_addon && (
                <span className="text-[10px] bg-amber-500 text-white px-1.5 py-0.5 rounded font-black animate-pulse">
                  ADD-ON
                </span>
              )}
            </div>
            <div className="text-sm text-muted font-bold uppercase tracking-wider mt-1 flex items-center gap-2.5">
              {order.status === 'double_checking' && (
                <span>{`Checking: ${order.checker_profile?.full_name?.split(' ')[0] ?? '...'}`}</span>
              )}
              {typeof order.pallets_qty === 'number' && order.pallets_qty > 0 && (
                <span className="text-sky-400/80">
                  {order.pallets_qty} {order.pallets_qty === 1 ? 'pallet' : 'pallets'}
                </span>
              )}
              {units > 0 && (
                <span className="text-muted/80">
                  {units} {units === 1 ? 'unit' : 'units'}
                </span>
              )}
            </div>
            {order.is_waiting_inventory && order.source_order_date && (
              <div className="text-[11px] text-subtle font-bold uppercase tracking-wider mt-0.5">
                Order date:{' '}
                {new Date(`${order.source_order_date}T00:00:00`).toLocaleDateString('en-US', {
                  month: 'short',
                  day: 'numeric',
                  year: 'numeric',
                })}
              </div>
            )}
            {notePreview && (
              <div
                className="mt-1.5 text-xs font-semibold text-red-500 bg-red-500/10 rounded px-2 py-1 max-w-[240px] truncate"
                title={trimmedNote ?? undefined}
              >
                {notePreview}
              </div>
            )}
          </div>
        </div>
        <ChevronDown
          size={20}
          className={`-rotate-90 text-subtle ${statusStyles.chevronHover} transition-colors`}
        />
      </button>
      {order.group_id && onUngroup && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onUngroup(order);
          }}
          className="p-1.5 text-muted hover:text-amber-500 transition-colors"
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
        className="p-1.5 text-muted hover:text-red-500 transition-colors"
        title="Delete Order"
      >
        <Trash2 size={16} />
      </button>
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
