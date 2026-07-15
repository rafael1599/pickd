import React from 'react';
import type { PickingList } from '../../hooks/useDoubleCheckList';
import { StaticOrderCard } from './SortableOrderCard';

interface CompletedZoneProps {
  fedexOrders: PickingList[];
  regularOrders: PickingList[];
  onSelectOrder: (orderId: string) => void;
  /** Prefix the time with the date ("Jul 9 · 3:51 PM") — used when the list
   *  spans previous days (empty-board fallback). */
  showDate?: boolean;
}

export const CompletedZone: React.FC<CompletedZoneProps> = ({
  fedexOrders,
  regularOrders,
  onSelectOrder,
  showDate = false,
}) => {
  if (fedexOrders.length === 0 && regularOrders.length === 0) return null;

  const renderOrderButton = (order: PickingList) => {
    return (
      <StaticOrderCard
        key={order.id}
        order={order}
        shippingType={order.shipping_type === 'fedex' ? 'fedex' : 'regular'}
        showShippingBadge={false}
        showDate={showDate}
        onSelect={() => onSelectOrder(order.id)}
      />
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
          <div className="grid grid-cols-1 gap-2">{fedexOrders.map(renderOrderButton)}</div>
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
          <div className="grid grid-cols-1 gap-2">{regularOrders.map(renderOrderButton)}</div>
        )}
      </div>
    </div>
  );
};
