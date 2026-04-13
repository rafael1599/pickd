import React from 'react';
import CheckCircle2 from 'lucide-react/dist/esm/icons/check-circle-2';
import type { PickingList } from '../../hooks/useDoubleCheckList';

interface CompletedZoneProps {
  orders: PickingList[];
  onSelectOrder: (orderId: string) => void;
}

export const CompletedZone: React.FC<CompletedZoneProps> = ({ orders, onSelectOrder }) => {
  if (orders.length === 0) return null;

  return (
    <div className="space-y-1">
      {orders.map((order) => (
        <button
          key={order.id}
          onClick={() => onSelectOrder(order.id)}
          className="w-full flex items-center gap-2.5 p-2.5 rounded-xl bg-card border border-subtle hover:border-accent/20 transition-all text-left active:scale-[0.98]"
        >
          <div className="w-7 h-7 rounded-lg bg-main flex items-center justify-center text-muted shrink-0">
            <CheckCircle2 size={13} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-[10px] font-black text-content uppercase tracking-tight truncate">
              #{order.order_number || order.id.toString().slice(-6).toUpperCase()}
            </div>
            <div className="text-[8px] text-muted font-bold uppercase tracking-tighter truncate">
              {order.customer?.name || 'Customer'}
            </div>
          </div>
          {/* Shipping type indicator dot */}
          {order.shipping_type && (
            <div
              className={`w-2 h-2 rounded-full shrink-0 ${
                order.shipping_type === 'fedex' ? 'bg-purple-500' : 'bg-emerald-500'
              }`}
              title={order.shipping_type === 'fedex' ? 'FedEx' : 'Regular'}
            />
          )}
        </button>
      ))}
    </div>
  );
};
