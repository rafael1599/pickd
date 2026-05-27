import React from 'react';
import { useDraggable, useDroppable } from '@dnd-kit/core';
import Unlink from 'lucide-react/dist/esm/icons/unlink';
import Trash2 from 'lucide-react/dist/esm/icons/trash-2';
import ChevronDown from 'lucide-react/dist/esm/icons/chevron-down';
import AlertCircle from 'lucide-react/dist/esm/icons/alert-circle';
import Clock from 'lucide-react/dist/esm/icons/clock';
import type { PickingList } from '../../hooks/useDoubleCheckList';

interface GroupCardProps {
  orders: PickingList[];
  groupType: string;
  onSelect: (order: PickingList) => void;
  onDelete: (order: PickingList) => void;
  onUngroup: (order: PickingList) => void;
}

// Group label drops the carrier prefix — FedEx groups already live on the
// purple lane so 'FDX GROUP' is redundant; just 'GROUP' is enough.
const GROUP_COLORS: Record<string, { border: string; bg: string; label: string; text: string }> = {
  fedex: {
    border: 'border-purple-500/30',
    bg: 'bg-purple-500/5',
    label: 'GROUP',
    text: 'text-purple-400',
  },
  general: {
    border: 'border-sky-500/30',
    bg: 'bg-sky-500/5',
    label: 'GROUP',
    text: 'text-sky-400',
  },
};

export const GroupCard = React.memo<GroupCardProps>(
  ({ orders, groupType, onSelect, onDelete, onUngroup }) => {
    const firstOrder = orders[0] ?? null;
    const colors = GROUP_COLORS[groupType] ?? GROUP_COLORS.general;
    const groupId = firstOrder?.group_id ?? 'empty';

    // Aggregate state for the group header — surface "needs attention" at the
    // group level so the verifier sees the warning without expanding.
    const hasCorrection = orders.some((o) => o.status === 'needs_correction');
    const hasDoubleChecking = orders.some((o) => o.status === 'double_checking');
    const totalPallets = orders.reduce((sum, o) => sum + (o.pallets_qty ?? 0), 0);

    const draggable = useDraggable({
      id: `drag-group-${groupId}`,
      data: { order: firstOrder, shippingType: firstOrder?.shipping_type ?? 'regular' },
      disabled: !firstOrder,
    });
    const droppable = useDroppable({
      id: `group-${groupId}`,
      data: { order: firstOrder, shippingType: firstOrder?.shipping_type ?? 'regular' },
      disabled: !firstOrder,
    });

    if (!firstOrder) return null;

    return (
      <div
        ref={(node) => {
          draggable.setNodeRef(node);
          droppable.setNodeRef(node);
        }}
        style={{
          transform: draggable.transform
            ? `translate(${draggable.transform.x}px, ${draggable.transform.y}px)`
            : undefined,
          touchAction: 'none',
        }}
        className={`rounded-xl border-2 border-dashed ${colors.border} ${colors.bg} transition-all duration-200 ${
          droppable.isOver ? 'scale-[1.02] shadow-lg' : ''
        } ${draggable.isDragging ? 'opacity-30 scale-95' : ''}`}
        {...draggable.attributes}
        {...draggable.listeners}
      >
        {/* Group header — aggregates needs-attention + total pallets so the
            verifier scans the worst state at a glance. */}
        <div className="px-2 pt-1.5 pb-0.5 flex items-center justify-between gap-1">
          <div className="flex items-center gap-1">
            <span className={`text-[7px] font-black uppercase tracking-widest ${colors.text}`}>
              {colors.label}
            </span>
            {hasCorrection && (
              <span
                className="flex items-center gap-0.5 text-amber-500 text-[7px] font-black uppercase tracking-widest"
                title="At least one order in this group needs correction"
              >
                <AlertCircle size={9} />
                Fix
              </span>
            )}
            {!hasCorrection && hasDoubleChecking && (
              <span
                className="flex items-center gap-0.5 text-orange-500 text-[7px] font-black uppercase tracking-widest"
                title="Currently being checked"
              >
                <Clock size={9} />
                Checking
              </span>
            )}
          </div>
          {totalPallets > 0 && (
            <span className="text-[7px] font-black uppercase tracking-widest text-sky-400/70">
              {totalPallets} {totalPallets === 1 ? 'pallet' : 'pallets'}
            </span>
          )}
        </div>

        {/* Stacked order numbers — each row carries its own status indicator
            and pallet count so the verifier knows which specific order in
            the group needs attention. */}
        <div className="px-1 pb-1 space-y-0.5">
          {orders.map((order) => {
            const orderNeedsCorrection = order.status === 'needs_correction';
            const orderDoubleChecking = order.status === 'double_checking';
            return (
              <div
                key={order.id}
                className="flex items-center gap-1 rounded-lg hover:bg-white/5 transition-colors"
              >
                <button
                  onClick={() => onSelect(order)}
                  className="flex-1 flex items-center justify-between py-1 px-1.5 text-left"
                >
                  <div className="text-[11px] font-black uppercase tracking-tight text-content flex items-center gap-1">
                    {orderNeedsCorrection && (
                      <AlertCircle size={11} className="text-amber-500 shrink-0" />
                    )}
                    {orderDoubleChecking && (
                      <Clock size={11} className="text-orange-500 shrink-0" />
                    )}
                    {order.source === 'pdf_import' && (
                      <span title="PDF Import" className="mr-0.5">
                        📥
                      </span>
                    )}
                    #{order.order_number || order.id.toString().slice(-6).toUpperCase()}
                  </div>
                  <div className="flex items-center gap-1.5">
                    {(order.pallets_qty ?? 0) > 0 && (
                      <span className="text-[8px] font-black text-sky-400/80 uppercase tracking-wider">
                        {order.pallets_qty}p
                      </span>
                    )}
                    <ChevronDown size={12} className="-rotate-90 text-subtle" />
                  </div>
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onUngroup(order);
                  }}
                  className="p-0.5 text-muted hover:text-amber-500 transition-colors"
                  title="Remove from group"
                >
                  <Unlink size={10} />
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onDelete(order);
                  }}
                  className="p-0.5 text-muted hover:text-red-500 transition-colors"
                  title="Delete"
                >
                  <Trash2 size={10} />
                </button>
              </div>
            );
          })}
        </div>
      </div>
    );
  }
);

GroupCard.displayName = 'GroupCard';
