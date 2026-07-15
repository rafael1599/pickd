import React from 'react';
import AlertCircle from 'lucide-react/dist/esm/icons/alert-circle';
import Clock from 'lucide-react/dist/esm/icons/clock';
import MoreVertical from 'lucide-react/dist/esm/icons/more-vertical';
import type { PickingList } from '../../hooks/useDoubleCheckList';

interface GroupCardProps {
  orders: PickingList[];
  groupType: string;
  onSelect: (order: PickingList) => void;
  onMerge: (order: PickingList) => void;
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

export const GroupCard = React.memo<GroupCardProps>(({ orders, groupType, onSelect, onMerge }) => {
  const firstOrder = orders[0] ?? null;
  const colors = GROUP_COLORS[groupType] ?? GROUP_COLORS.general;

  // Aggregate state for the group — surface "needs attention" at the group
  // level so the verifier sees the worst status without opening the order.
  const hasCorrection = orders.some((o) => o.status === 'needs_correction');
  const hasDoubleChecking = orders.some((o) => o.status === 'double_checking');
  const totalPallets = orders.reduce((sum, o) => sum + (o.pallets_qty ?? 0), 0);

  // Combined order numbers on a single line, e.g. "#083 / 121 / 140". Tapping
  // anywhere on the card opens the combined double-check view (all together).
  const orderNumbers = orders
    .map((o) => o.order_number || o.id.toString().slice(-6).toUpperCase())
    .join(' / ');

  if (!firstOrder) return null;

  return (
    <div className="relative group w-full">
      <button
        onClick={() => onSelect(firstOrder)}
        className={`w-full flex items-center gap-3 p-3 rounded-2xl bg-card border-2 border-dashed ${colors.border} ${colors.bg} hover:brightness-110 transition-all text-left active:scale-[0.98]`}
      >
        {/* GRP badge with member count */}
        <div
          className={`flex flex-col items-center justify-center shrink-0 w-9 h-9 rounded-xl border ${colors.border} ${colors.bg}`}
        >
          <span className={`text-[10px] font-black ${colors.text}`}>GRP</span>
          <span className={`text-[8px] font-bold ${colors.text} opacity-80 leading-none`}>
            {orders.length}
          </span>
        </div>

        <div className="min-w-0 flex-1 pr-6">
          {/* Aggregate status row — worst state + total pallets at a glance */}
          <div className="flex items-center gap-1.5 mb-0.5">
            <span className={`text-[11px] font-black uppercase tracking-widest ${colors.text}`}>
              {colors.label}
            </span>
            {hasCorrection && (
              <span
                className="flex items-center gap-0.5 text-amber-500 text-[11px] font-black uppercase tracking-widest"
                title="At least one order in this group needs correction"
              >
                <AlertCircle size={12} />
                Fix
              </span>
            )}
            {!hasCorrection && hasDoubleChecking && (
              <span
                className="flex items-center gap-0.5 text-orange-500 text-[11px] font-black uppercase tracking-widest"
                title="Currently being checked"
              >
                <Clock size={12} />
                Checking
              </span>
            )}
            {totalPallets > 0 && (
              <span className="ml-auto text-[11px] font-black uppercase tracking-widest text-sky-400/70">
                {totalPallets} {totalPallets === 1 ? 'pallet' : 'pallets'}
              </span>
            )}
          </div>

          {/* Combined order numbers on one line */}
          <div className="text-[clamp(1.1rem,1.7vw,2.15rem)] leading-none font-black text-content uppercase tracking-tight truncate">
            #{orderNumbers}
          </div>
        </div>
      </button>

      {/* Single 3-dot menu — opens Order Options (merge / ungroup / …) */}
      <div className="absolute top-2 right-2 opacity-100 lg:opacity-0 lg:group-hover:opacity-100 transition-opacity bg-card/90 backdrop-blur-sm rounded-xl p-1 shadow-md border border-subtle z-10">
        <button
          onClick={(e) => {
            e.stopPropagation();
            onMerge(firstOrder);
          }}
          className="p-1 text-muted hover:text-content transition-colors rounded-lg hover:bg-content/[0.05]"
          title="Order options"
        >
          <MoreVertical className="w-4.5 h-4.5" />
        </button>
      </div>
    </div>
  );
});

GroupCard.displayName = 'GroupCard';
