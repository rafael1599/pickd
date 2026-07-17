import React from 'react';
import type { PickingList } from '../../hooks/useDoubleCheckList';
import { StaticOrderCard } from './SortableOrderCard';

interface CompletedZoneProps {
  fedexOrders: PickingList[];
  regularOrders: PickingList[];
  onSelectOrder: (orderId: string) => void;
  onMerge?: (order: PickingList) => void;
  onUngroup?: (order: PickingList) => void;
  onDelete?: (order: PickingList) => void;
  /** Prefix the time with the date ("Jul 9 · 3:51 PM") — used when the list
   *  spans previous days (empty-board fallback). */
  showDate?: boolean;
}

export const CompletedZone: React.FC<CompletedZoneProps> = ({
  fedexOrders,
  regularOrders,
  onSelectOrder,
  onMerge,
  onUngroup,
  onDelete,
  showDate = false,
}) => {
  if (fedexOrders.length === 0 && regularOrders.length === 0) return null;

  const renderOrderButton = (order: PickingList, shippingType: 'fedex' | 'regular') => {
    return (
      <StaticOrderCard
        key={order.id}
        order={order}
        shippingType={shippingType}
        showShippingBadge={true}
        showDate={showDate}
        onSelect={() => onSelectOrder(order.id)}
        onMerge={onMerge}
        onUngroup={onUngroup}
        onDelete={onDelete}
      />
    );
  };

  return (
    <div className="space-y-4">
      {/* Regular Completed Orders Row */}
      <div className="space-y-2">
        {regularOrders.length > 0 ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {regularOrders.map((order) => renderOrderButton(order, 'regular'))}
          </div>
        ) : null}
      </div>

      {/* FedEx Completed Orders Row */}
      <div className="space-y-2">
        {fedexOrders.length > 0 ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {fedexOrders.map((order) => renderOrderButton(order, 'fedex'))}
          </div>
        ) : null}
      </div>

      {/* Empty state */}
      {regularOrders.length === 0 && fedexOrders.length === 0 && (
        <div className="text-center text-xs text-muted/40 italic py-4 bg-subtle/20 border border-dashed border-subtle rounded-2xl">
          No completed orders
        </div>
      )}
    </div>
  );
};
