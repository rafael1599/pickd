import React from 'react';
import { useDraggable, useDroppable } from '@dnd-kit/core';
import CheckCircle2 from 'lucide-react/dist/esm/icons/check-circle-2';
import Clock from 'lucide-react/dist/esm/icons/clock';
import AlertCircle from 'lucide-react/dist/esm/icons/alert-circle';
import Trash2 from 'lucide-react/dist/esm/icons/trash-2';
import Unlink from 'lucide-react/dist/esm/icons/unlink';
import type { PickingList } from '../../hooks/useDoubleCheckList';

import { TransportLogo } from '../../../../components/orders/TransportLogo';

type ShippingType = 'fedex' | 'regular';

interface CardProps {
  order: PickingList;
  shippingType: ShippingType;
  showShippingBadge?: boolean;
  onSelect: (order: PickingList) => void;
  onDelete?: (order: PickingList) => void;
  onUngroup?: (order: PickingList) => void;
  showDate?: boolean;
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

function completedAtLabel(iso: string | undefined, showDate: boolean): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
  if (!showDate) return time;
  const date = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  return `${date} · ${time}`;
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
  showDate = false,
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
  const when = order.status === 'completed' ? completedAtLabel(order.updated_at, showDate) : null;

  // Calculate bikes and parts counts from order items using the 03- prefix heuristic
  const { bikesCount, partsCount } = React.useMemo(() => {
    let bikes = 0;
    let parts = 0;
    if (Array.isArray(order.items)) {
      for (const item of order.items) {
        const qty = (item.pickingQty as number) || (item.qty as number) || 0;
        if (item.sku && item.sku.startsWith('03-')) {
          bikes += qty;
        } else {
          parts += qty;
        }
      }
    }
    return { bikesCount: bikes, partsCount: parts };
  }, [order.items]);

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`relative flex flex-col rounded-2xl overflow-hidden bg-card transition-all duration-200 group border ${
        isOver ? 'border-2 border-purple-500 bg-purple-500/10 scale-[1.02]' : statusStyles.border
      } ${statusStyles.hoverBg} ${isDragging ? 'opacity-30 scale-95 z-50' : ''} ${
        order.status === 'completed' && showDate ? 'sm:col-span-2' : ''
      }`}
      {...(attributes as React.HTMLAttributes<HTMLDivElement>)}
      {...(listeners as React.HTMLAttributes<HTMLDivElement>)}
    >
      {showShippingBadge && <div className={`h-1.5 shrink-0 ${colors.stripe}`} />}

      <div className="flex-1 flex items-stretch min-w-0">
        {/* Left Panel: Quantities */}
        <div className="flex flex-col items-center justify-center border-r border-subtle bg-content/[0.02] py-2 px-2.5 shrink-0 self-stretch min-w-[76px] md:min-w-[84px] gap-2 select-none">
          <div className="flex flex-col gap-1.5 w-full text-center">
            {/* Pallets Row (Regular only) */}
            {shippingType === 'regular' &&
              typeof order.pallets_qty === 'number' &&
              order.pallets_qty > 0 && (
                <div className="flex flex-col leading-none">
                  <span className="text-base md:text-lg font-black text-sky-400">
                    {order.pallets_qty}
                  </span>
                  <span className="text-[8px] md:text-[9px] font-bold text-muted uppercase tracking-wider mt-0.5">
                    {order.pallets_qty === 1 ? 'Pallet' : 'Pallets'}
                  </span>
                </div>
              )}

            {/* Bikes Row */}
            {bikesCount > 0 && (
              <div className="flex flex-col leading-none">
                <span className="text-base md:text-lg font-black text-amber-500">{bikesCount}</span>
                <span className="text-[8px] md:text-[9px] font-bold text-muted uppercase tracking-wider mt-0.5">
                  {bikesCount === 1 ? 'Bike' : 'Bikes'}
                </span>
              </div>
            )}

            {/* Parts Row */}
            {partsCount > 0 && (
              <div className="flex flex-col leading-none">
                <span className="text-base md:text-lg font-black text-emerald-500">
                  {partsCount}
                </span>
                <span className="text-[8px] md:text-[9px] font-bold text-muted uppercase tracking-wider mt-0.5">
                  {partsCount === 1 ? 'Part' : 'Parts'}
                </span>
              </div>
            )}

            {/* Placeholder if empty */}
            {!(shippingType === 'regular' && order.pallets_qty && order.pallets_qty > 0) &&
              bikesCount === 0 &&
              partsCount === 0 && (
                <div className="flex flex-col leading-none">
                  <span className="text-base md:text-lg font-black text-muted/40">—</span>
                  <span className="text-[8px] md:text-[9px] font-bold text-muted uppercase tracking-wider mt-0.5">
                    Items
                  </span>
                </div>
              )}
          </div>
        </div>

        {/* Right Panel */}
        <button
          onClick={() => onSelect(order)}
          className={`flex-1 text-left px-3 py-2.5 md:px-4 md:py-3 flex flex-col justify-center gap-1 min-w-0 ${
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
              #{order.order_number || order.id.toString().slice(-6).toUpperCase()}
            </span>
            {order.is_addon && (
              <span className="shrink-0 text-[clamp(0.6rem,1vw,1rem)] bg-amber-500 text-white px-1.5 py-0.5 rounded font-black animate-pulse">
                ADD-ON
              </span>
            )}
          </div>
          <div className="flex items-baseline gap-3 min-w-0">
            {when ? (
              <span className="text-[clamp(0.85rem,1.2vw,1.4rem)] text-muted font-bold uppercase tracking-wide truncate">
                {when}
              </span>
            ) : worker ? (
              <span className="text-[clamp(1.05rem,1.8vw,2.25rem)] leading-tight font-bold uppercase tracking-wide text-muted truncate">
                {worker}
              </span>
            ) : null}
          </div>
        </button>

        {/* Rightmost actions and carrier logo */}
        <div className="flex items-center shrink-0 pr-3 gap-2 self-center">
          {/* Carrier Logo on the Right */}
          <div className="flex items-center justify-center">
            {shippingType === 'fedex' ? (
              <span className="text-[10px] font-black uppercase tracking-wider text-purple-400 bg-purple-500/10 px-1.5 py-0.5 rounded whitespace-nowrap">
                FedEx
              </span>
            ) : order.transport_company ? (
              <TransportLogo
                company={order.transport_company}
                height={16}
                className="max-w-[64px]"
              />
            ) : (
              <span className="text-[10px] font-black uppercase tracking-wider text-emerald-400 bg-emerald-500/10 px-1.5 py-0.5 rounded whitespace-nowrap">
                Regular
              </span>
            )}
          </div>

          {/* Action Buttons */}
          {((order.group_id && onUngroup) || onDelete) && (
            <div className="flex items-center gap-1 pl-1.5 border-l border-subtle">
              {order.group_id && onUngroup && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onUngroup(order);
                  }}
                  className="p-1.5 text-muted/60 hover:text-amber-500 transition-colors"
                  title="Remove from group"
                >
                  <Unlink size={14} />
                </button>
              )}
              {onDelete && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onDelete(order);
                  }}
                  className="p-1.5 text-muted/60 hover:text-red-500 transition-colors"
                  title="Delete Order"
                >
                  <Trash2 size={14} />
                </button>
              )}
            </div>
          )}
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
