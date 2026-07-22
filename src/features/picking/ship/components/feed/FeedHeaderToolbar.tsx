import React from 'react';
import { CarrierFilter } from '../../../components/board/CarrierFilter';

interface FeedHeaderToolbarProps {
  toShipCount: number;
  shippedCount: number;
  eligibleShippingCount: number;
  includeShipped: boolean;
  onIncludeShippedChange: (include: boolean) => void;
  onStartShippingClick: () => void;
  availableCarriers: string[];
  selectedCarriers: Set<string>;
  includeUnassigned: boolean;
  hasUnassignedOrders: boolean;
  carrierCounts: Map<string, number>;
  unassignedCount: number;
  onCarrierToggle: (carrier: string) => void;
  onUnassignedToggle: (include: boolean) => void;
}

export const FeedHeaderToolbar: React.FC<FeedHeaderToolbarProps> = ({
  toShipCount,
  shippedCount,
  eligibleShippingCount,
  includeShipped,
  onIncludeShippedChange,
  onStartShippingClick,
  availableCarriers,
  selectedCarriers,
  includeUnassigned,
  hasUnassignedOrders,
  carrierCounts,
  unassignedCount,
  onCarrierToggle,
  onUnassignedToggle,
}) => {
  return (
    <>
      <div className="px-2 pb-1 flex items-center justify-between min-h-[24px] gap-3">
        <span className="text-sm font-black uppercase tracking-wider text-content min-w-0 truncate">
          Pending Ship ({toShipCount})
        </span>

        <div className="flex items-center gap-2 shrink-0">
          {eligibleShippingCount > 0 && (
            <button
              onClick={onStartShippingClick}
              className="text-[9px] font-black uppercase tracking-wider px-1.5 py-0.5 rounded border border-accent/30 bg-accent/10 text-accent hover:bg-accent hover:text-white transition-all select-none"
            >
              Start Shipping ({eligibleShippingCount})
            </button>
          )}
          <label className="flex items-center gap-1.5 cursor-pointer select-none min-w-0">
            <input
              type="checkbox"
              checked={includeShipped}
              onChange={(e) => onIncludeShippedChange(e.target.checked)}
              className="w-3.5 h-3.5 rounded border-subtle accent-emerald-500 cursor-pointer shrink-0"
            />
            <span
              className={`text-[10px] font-black uppercase tracking-wider ${
                includeShipped ? 'text-emerald-400' : 'text-muted'
              }`}
            >
              Shipped ({shippedCount})
            </span>
          </label>
        </div>
      </div>

      {availableCarriers.length > 0 && (
        <div className="px-2">
          <CarrierFilter
            selectedCarriers={selectedCarriers}
            includeUnassigned={includeUnassigned}
            hasUnassignedOrders={hasUnassignedOrders}
            availableCarriers={availableCarriers}
            carrierCounts={carrierCounts}
            unassignedCount={unassignedCount}
            onCarrierToggle={onCarrierToggle}
            onUnassignedToggle={onUnassignedToggle}
          />
        </div>
      )}
    </>
  );
};
