import React from 'react';
import AlertCircle from 'lucide-react/dist/esm/icons/alert-circle';
import Clock from 'lucide-react/dist/esm/icons/clock';
import MoreVertical from 'lucide-react/dist/esm/icons/more-vertical';
import Unlink from 'lucide-react/dist/esm/icons/unlink';
import Trash2 from 'lucide-react/dist/esm/icons/trash-2';
import type { PickingList } from '../../hooks/useDoubleCheckList';
import { getWorkerLabel, isActivelyChecking } from './SortableOrderCard';
import { orderColorFor } from '../../../../utils/orderColors';

interface FedexGroupCardProps {
  orders: PickingList[];
  onSelect: (order: PickingList) => void;
  onDelete: (order: PickingList) => void;
  onUngroup: (order: PickingList) => void;
  onMerge: (order: PickingList) => void;
}

/**
 * FedEx groups keep a stacked, per-order layout (unlike general groups, which
 * collapse into one standard card): FedEx auto-groups grow and shrink all day,
 * so each order needs its own quick Ungroup/Delete/menu buttons. Tapping any
 * row opens the combined double-check view with every order in the group.
 * The purple dashed container marks the FedEx group boundary.
 */
export const FedexGroupCard = React.memo<FedexGroupCardProps>(
  ({ orders, onSelect, onDelete, onUngroup, onMerge }) => {
    if (orders.length === 0) return null;

    const hasCorrection = orders.some((o) => o.status === 'needs_correction');
    const hasDoubleChecking = orders.some(isActivelyChecking);
    const totalPallets = orders.reduce((sum, o) => sum + (o.pallets_qty ?? 0), 0);

    return (
      <div className="relative rounded-2xl border-2 border-dashed border-purple-500/40 bg-purple-500/5 transition-all duration-200 w-full">
        {/* Slim aggregate header — worst state + total pallets at a glance. */}
        <div className="px-2.5 pt-2 pb-1 flex items-center justify-between gap-1">
          <div className="flex items-center gap-1.5">
            <span className="text-[11px] font-black uppercase tracking-widest text-purple-400">
              FedEx · {orders.length}
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

        {/* One row per order — tap opens the combined double-check view. */}
        <div className="px-1 pb-1 space-y-0.5">
          {orders.map((order) => {
            const allNumbers = orders.map((o) =>
              String(o.order_number || o.id.toString().slice(-6).toUpperCase())
            );
            const fullNum = String(
              order.order_number || order.id.toString().slice(-6).toUpperCase()
            );
            const c = orderColorFor(fullNum, allNumbers);
            const firstPart = fullNum.length > 3 ? fullNum.slice(0, -3) : '';
            const lastThree = fullNum.slice(-3);
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
                  <div className="text-[clamp(1.1rem,1.8vw,2rem)] leading-tight font-black uppercase tracking-tight flex items-center gap-1.5 min-w-0">
                    {order.status === 'needs_correction' && (
                      <AlertCircle size={18} className="text-amber-500 shrink-0" />
                    )}
                    {isActivelyChecking(order) && (
                      <Clock size={18} className="text-orange-500 shrink-0" />
                    )}
                    <span className="whitespace-nowrap">
                      <span className="text-content/35 mr-0.5 select-none">#{firstPart}</span>
                      <span
                        style={{ textShadow: c.shadow }}
                        className={`${c.face} text-[1.15em] font-black tracking-tight leading-none inline-block align-baseline relative z-10`}
                      >
                        {lastThree}
                      </span>
                    </span>
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
                  </div>
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onMerge(order);
                  }}
                  className="p-1.5 text-muted hover:text-content transition-colors shrink-0"
                  title="Order options"
                >
                  <MoreVertical size={15} />
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onUngroup(order);
                  }}
                  className="p-1.5 text-muted hover:text-amber-500 transition-colors shrink-0"
                  title="Ungroup"
                >
                  <Unlink size={15} />
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onDelete(order);
                  }}
                  className="p-1.5 pr-2 text-muted hover:text-red-500 transition-colors shrink-0"
                  title="Delete Order"
                >
                  <Trash2 size={15} />
                </button>
              </div>
            );
          })}
        </div>
      </div>
    );
  }
);

FedexGroupCard.displayName = 'FedexGroupCard';
