import React from 'react';
import { ShipOrderSkeleton } from './ShipOrderSkeleton';
import Search from 'lucide-react/dist/esm/icons/search';

interface OrderDetailsContainerProps {
  selectedOrderId: string | null;
  isLoadingDetails: boolean;
  children: React.ReactNode;
}

export const OrderDetailsContainer: React.FC<OrderDetailsContainerProps> = ({
  selectedOrderId,
  isLoadingDetails,
  children,
}) => {
  const renderContent = () => {
    if (!selectedOrderId) {
      return (
        <div className="h-full min-h-[50vh] flex flex-col items-center justify-center text-text-muted space-y-4">
          <div className="w-16 h-16 rounded-full bg-surface border border-subtle flex items-center justify-center shadow-sm">
            <Search size={32} className="opacity-20" />
          </div>
          <p className="font-heading text-xl font-bold opacity-30">Select an order to preview</p>
        </div>
      );
    }

    if (isLoadingDetails) {
      return <ShipOrderSkeleton />;
    }

    return <>{children}</>;
  };

  const stateKey = selectedOrderId
    ? isLoadingDetails
      ? `loading-${selectedOrderId}`
      : `loaded-${selectedOrderId}`
    : 'empty';

  return (
    <>
      <style>{`
        @keyframes shipFadeIn {
          from { opacity: 0; transform: translateY(4px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .animate-ship-fade-in {
          animation: shipFadeIn 200ms ease-in-out;
        }
      `}</style>
      <div
        key={stateKey}
        className="h-full transition-opacity duration-200 ease-in-out animate-ship-fade-in"
      >
        {renderContent()}
      </div>
    </>
  );
};
