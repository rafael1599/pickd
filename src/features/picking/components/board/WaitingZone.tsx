import React from 'react';
import Hourglass from 'lucide-react/dist/esm/icons/hourglass';
import type { PickingList } from '../../hooks/useDoubleCheckList';

interface WaitingZoneProps {
  orders: PickingList[];
  onSelect: (order: PickingList) => void;
}

export const WaitingZone: React.FC<WaitingZoneProps> = ({ orders, onSelect }) => {
  if (orders.length === 0) return null;

  return (
    <div className="space-y-1">
      {orders.map((order) => (
        <button
          key={order.id}
          onClick={() => onSelect(order)}
          className="w-full flex items-center gap-3 p-3 rounded-xl bg-card border border-amber-500/10 hover:border-amber-500/30 transition-all text-left active:scale-[0.98]"
        >
          <div className="w-8 h-8 rounded-xl bg-amber-500/10 flex items-center justify-center text-amber-500 shrink-0">
            <Hourglass size={16} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-xs font-black text-content uppercase tracking-tight truncate">
              #{order.order_number || order.id.toString().slice(-6).toUpperCase()}
            </div>
            <div className="text-[9px] text-amber-500/70 font-bold truncate mt-0.5">
              {order.waiting_reason || 'Waiting for inventory'}
            </div>
            <div className="text-[8px] text-muted font-bold uppercase tracking-tighter truncate">
              {order.customer?.name || 'Customer'}
            </div>
          </div>
        </button>
      ))}
    </div>
  );
};
