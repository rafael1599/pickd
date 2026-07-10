import React from 'react';
import CheckCircle2 from 'lucide-react/dist/esm/icons/check-circle-2';
import type { PickingList } from '../../hooks/useDoubleCheckList';

interface CompletedZoneProps {
  orders: PickingList[];
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
  orders,
  onSelectOrder,
  showDate = false,
}) => {
  if (orders.length === 0) return null;

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-2">
      {orders.map((order) => {
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
            {order.shipping_type && (
              <div
                className={`w-2.5 h-2.5 rounded-full shrink-0 ${
                  order.shipping_type === 'fedex' ? 'bg-purple-500' : 'bg-emerald-500'
                }`}
                title={order.shipping_type === 'fedex' ? 'FedEx' : 'Regular'}
              />
            )}
          </button>
        );
      })}
    </div>
  );
};
