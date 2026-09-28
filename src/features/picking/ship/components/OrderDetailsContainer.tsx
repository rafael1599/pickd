import React from 'react';
import { ShipOrderSkeleton } from './ShipOrderSkeleton';
import Search from 'lucide-react/dist/esm/icons/search';

interface OrderDetailsContainerProps {
  selectedOrderId: string | null;
  /** No order to show yet, but one is on its way (the list, or its auto-select). */
  isWaitingForOrder: boolean;
  children: React.ReactNode;
}

/**
 * The card paints from the list row the moment an order is selected and the
 * detail fills it in place. It used to swap to the skeleton on every selection
 * and remount with a slide-in, which pushed the list below it down twice per
 * order (CLS 0.32 on a 430 px phone).
 */
export const OrderDetailsContainer: React.FC<OrderDetailsContainerProps> = ({
  selectedOrderId,
  isWaitingForOrder,
  children,
}) => {
  if (selectedOrderId) return <div className="h-full">{children}</div>;
  if (isWaitingForOrder) return <ShipOrderSkeleton />;
  return (
    <div className="h-full min-h-[50vh] flex flex-col items-center justify-center text-text-muted space-y-4">
      <div className="w-16 h-16 rounded-full bg-surface border border-subtle flex items-center justify-center shadow-sm">
        <Search size={32} className="opacity-20" />
      </div>
      <p className="font-heading text-xl font-bold opacity-30">Select an order to preview</p>
    </div>
  );
};
