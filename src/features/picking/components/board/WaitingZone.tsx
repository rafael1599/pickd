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
    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-2">
      {orders.map((order) => (
        <button
          key={order.id}
          onClick={() => onSelect(order)}
          className="w-full flex items-center gap-3 p-3 rounded-2xl bg-card border border-amber-500/10 hover:border-amber-500/30 transition-all text-left active:scale-[0.98]"
        >
          <Hourglass size={20} className="text-amber-500 shrink-0" />
          <div className="min-w-0 flex-1">
            <div className="text-[clamp(1.2rem,1.8vw,2.25rem)] leading-none font-black text-content uppercase tracking-tight truncate">
              #{order.order_number || order.id.toString().slice(-6).toUpperCase()}
            </div>
            <div className="text-[clamp(0.85rem,1.2vw,1.4rem)] text-amber-500/80 font-bold truncate mt-0.5">
              {order.waiting_reason || 'Waiting for inventory'}
            </div>
            {order.source_order_date && (
              <div className="text-[clamp(0.8rem,1.1vw,1.25rem)] text-muted/70 font-bold uppercase tracking-tight truncate">
                {new Date(`${order.source_order_date}T00:00:00`).toLocaleDateString('en-US', {
                  month: 'short',
                  day: 'numeric',
                  year: 'numeric',
                })}
              </div>
            )}
          </div>
        </button>
      ))}
    </div>
  );
};
