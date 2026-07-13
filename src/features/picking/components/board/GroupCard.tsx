import React from 'react';
import Unlink from 'lucide-react/dist/esm/icons/unlink';
import Trash2 from 'lucide-react/dist/esm/icons/trash-2';
import ChevronDown from 'lucide-react/dist/esm/icons/chevron-down';
import AlertCircle from 'lucide-react/dist/esm/icons/alert-circle';
import Clock from 'lucide-react/dist/esm/icons/clock';
import MoreVertical from 'lucide-react/dist/esm/icons/more-vertical';
import type { PickingList } from '../../hooks/useDoubleCheckList';
import { getWorkerLabel } from './SortableOrderCard';

interface GroupCardProps {
  orders: PickingList[];
  groupType: string;
  onSelect: (order: PickingList) => void;
  onDelete: (order: PickingList) => void;
  onUngroup: (order: PickingList) => void;
  onMerge?: (order: PickingList) => void;
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
  ({ orders, groupType, onSelect, onDelete, onUngroup, onMerge }) => {
    const firstOrder = orders[0] ?? null;
    const colors = GROUP_COLORS[groupType] ?? GROUP_COLORS.general;

    // Aggregate state for the group header — surface "needs attention" at the
    // group level so the verifier sees the warning without expanding.
    const hasCorrection = orders.some((o) => o.status === 'needs_correction');
    const hasDoubleChecking = orders.some((o) => o.status === 'double_checking');
    const totalPallets = orders.reduce((sum, o) => sum + (o.pallets_qty ?? 0), 0);

    if (!firstOrder) return null;

    return (
      <div
        className={`relative rounded-xl border-2 border-dashed ${colors.border} ${colors.bg} transition-all duration-200 w-full`}
      >
        {/* Group header — aggregates needs-attention + total pallets so the
            verifier scans the worst state at a glance. */}
        <div className="px-2.5 pt-2 pb-1 flex items-center justify-between gap-1">
          <div className="flex items-center gap-1.5">
            <span className={`text-[11px] font-black uppercase tracking-widest ${colors.text}`}>
              {colors.label}
            </span>
            {hasCorrection && (
              <span
                className="flex items-center gap-0.5 text-amber-500 text-[11px] font-black uppercase tracking-widest"
                title="At least one order in this group needs correction"
              >
                <AlertCircle size={13} />
                Fix
              </span>
            )}
            {!hasCorrection && hasDoubleChecking && (
              <span
                className="flex items-center gap-0.5 text-orange-500 text-[11px] font-black uppercase tracking-widest"
                title="Currently being checked"
              >
                <Clock size={13} />
                Checking
              </span>
            )}
          </div>
          {totalPallets > 0 && (
            <span className="text-[11px] font-black uppercase tracking-widest text-sky-400/70">
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
            const worker = getWorkerLabel(order);
            return (
              <div
                key={order.id}
                className="flex items-center gap-1 rounded-lg hover:bg-white/5 transition-colors w-full"
              >
                <button
                  onClick={() => onSelect(order)}
                  className="flex-1 flex items-center justify-between py-1.5 px-2 text-left min-w-0"
                >
                  <div className="text-[clamp(1.1rem,1.8vw,2rem)] leading-tight font-black uppercase tracking-tight text-content flex items-center gap-1.5 min-w-0">
                    {orderNeedsCorrection && (
                      <AlertCircle size={18} className="text-amber-500 shrink-0" />
                    )}
                    {orderDoubleChecking && (
                      <Clock size={18} className="text-orange-500 shrink-0" />
                    )}
                    #{order.order_number || order.id.toString().slice(-6).toUpperCase()}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {(order.pallets_qty ?? 0) > 0 && (
                      <span className="text-[clamp(0.85rem,1.2vw,1.4rem)] font-black text-sky-400/80 uppercase tracking-wider">
                        {order.pallets_qty} PLT
                      </span>
                    )}
                    {worker && (
                      <span className="text-[clamp(0.8rem,1.1vw,1.3rem)] font-bold text-muted uppercase tracking-wide">
                        {worker}
                      </span>
                    )}
                    <ChevronDown size={16} className="-rotate-90 text-subtle" />
                  </div>
                </button>
                {onMerge && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onMerge(order);
                    }}
                    className="p-1 text-muted hover:text-sky-400 transition-colors shrink-0"
                    title="Merge/Combine Order"
                  >
                    <MoreVertical size={14} />
                  </button>
                )}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onUngroup(order);
                  }}
                  className="p-1 text-muted hover:text-amber-500 transition-colors shrink-0"
                  title="Remove from group"
                >
                  <Unlink size={14} />
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onDelete(order);
                  }}
                  className="p-1 text-muted hover:text-red-500 transition-colors shrink-0"
                  title="Delete"
                >
                  <Trash2 size={14} />
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
