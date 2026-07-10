import React from 'react';
import CheckCircle2 from 'lucide-react/dist/esm/icons/check-circle-2';
import type { PickingList } from '../../hooks/useDoubleCheckList';
import { TransportLogo } from '../../../../components/orders/TransportLogo';

interface CompletedZoneProps {
  fedexOrders: PickingList[];
  regularOrders: PickingList[];
  onSelectOrder: (orderId: string) => void;
  /** Prefix the time with the date ("Jul 9 · 3:51 PM") — used when the list
   *  spans previous days (empty-board fallback). */
  showDate?: boolean;
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

export const CompletedZone: React.FC<CompletedZoneProps> = ({
  fedexOrders,
  regularOrders,
  onSelectOrder,
  showDate = false,
}) => {
  if (fedexOrders.length === 0 && regularOrders.length === 0) return null;

  const renderOrderButton = (order: PickingList) => {
    const when = completedAtLabel(order.updated_at, showDate);
    return (
      <button
        key={order.id}
        onClick={() => onSelectOrder(order.id)}
        className="w-full flex items-center gap-3 p-3 rounded-2xl bg-card border border-subtle hover:border-accent/30 transition-all text-left active:scale-[0.98]"
      >
        <CheckCircle2 size={20} className="text-accent shrink-0 md:w-6 md:h-6" />
        <div className="min-w-0 flex-1">
          <div className="text-[clamp(1.2rem,1.8vw,2.25rem)] leading-none font-black text-content uppercase tracking-tight truncate">
            #{order.order_number || order.id.toString().slice(-6).toUpperCase()}
          </div>
          {when && (
            <div className="text-[clamp(0.85rem,1.2vw,1.4rem)] text-muted font-bold uppercase tracking-wide mt-0.5">
              {when}
            </div>
          )}
        </div>
        {order.shipping_type === 'fedex' ? (
          <div className="w-2.5 h-2.5 rounded-full shrink-0 bg-purple-500" title="FedEx" />
        ) : order.transport_company ? (
          <TransportLogo company={order.transport_company} height={16} className="shrink-0" />
        ) : (
          <div className="w-2.5 h-2.5 rounded-full shrink-0 bg-emerald-500" title="Regular" />
        )}
      </button>
    );
  };

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-6 divide-y md:divide-y-0 md:divide-x divide-subtle">
      {/* FedEx Completed Column */}
      <div className="flex flex-col gap-2 pb-4 md:pb-0">
        <div className="text-xs font-black uppercase tracking-widest text-purple-400 mb-1 px-1 flex items-center justify-between">
          <span>FedEx</span>
          <span className="text-[10px] text-muted font-bold">({fedexOrders.length})</span>
        </div>
        {fedexOrders.length === 0 ? (
          <div className="text-center text-xs text-muted/40 italic py-4 bg-purple-500/[0.02] border border-dashed border-subtle rounded-2xl">
            No completed FedEx orders
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {fedexOrders.map(renderOrderButton)}
          </div>
        )}
      </div>

      {/* Regular Completed Column */}
      <div className="flex flex-col gap-2 pt-4 md:pt-0 md:pl-6">
        <div className="text-xs font-black uppercase tracking-widest text-emerald-400 mb-1 px-1 flex items-center justify-between">
          <span>Regular</span>
          <span className="text-[10px] text-muted font-bold">({regularOrders.length})</span>
        </div>
        {regularOrders.length === 0 ? (
          <div className="text-center text-xs text-muted/40 italic py-4 bg-emerald-500/[0.02] border border-dashed border-subtle rounded-2xl">
            No completed Regular orders
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {regularOrders.map(renderOrderButton)}
          </div>
        )}
      </div>
    </div>
  );
};
