import React from 'react';
import { TransportLogo } from '../../../../components/orders/TransportLogo';
import { getCarrierTextColor } from '../../../../components/orders/transportLogos';

interface CarrierFilterProps {
  selectedCarriers: Set<string>;
  includeUnassigned: boolean;
  hasUnassignedOrders: boolean;
  availableCarriers: string[];
  onCarrierToggle: (carrier: string) => void;
  onUnassignedToggle: (include: boolean) => void;
}

export const CarrierFilter: React.FC<CarrierFilterProps> = ({
  selectedCarriers,
  includeUnassigned,
  hasUnassignedOrders,
  availableCarriers,
  onCarrierToggle,
  onUnassignedToggle,
}) => {
  const allSelected =
    selectedCarriers.size === availableCarriers.length &&
    (includeUnassigned || !hasUnassignedOrders);

  const handleSelectAll = () => {
    if (allSelected) {
      // Deselect all
      selectedCarriers.forEach((c) => onCarrierToggle(c));
      if (hasUnassignedOrders) {
        onUnassignedToggle(false);
      }
    } else {
      // Select all
      availableCarriers.forEach((c) => {
        if (!selectedCarriers.has(c)) {
          onCarrierToggle(c);
        }
      });
      if (hasUnassignedOrders && !includeUnassigned) {
        onUnassignedToggle(true);
      }
    }
  };

  return (
    <div className="space-y-3 p-4 bg-tertiary rounded-lg border border-subtle">
      <div className="flex items-center justify-between mb-2">
        <p className="text-xs font-semibold text-muted uppercase">Filter by Carrier</p>
        <button
          onClick={handleSelectAll}
          className="text-[11px] font-semibold text-accent hover:text-accent/80 transition"
        >
          {allSelected ? 'Clear All' : 'Select All'}
        </button>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-2">
        {/* Unassigned option - only show if there are unassigned orders */}
        {hasUnassignedOrders && (
          <button
            onClick={() => onUnassignedToggle(!includeUnassigned)}
            className={`flex flex-col items-center gap-2 p-2 rounded-lg border-2 transition-all ${
              includeUnassigned
                ? 'border-accent bg-accent/10'
                : 'border-subtle hover:border-accent/50'
            }`}
          >
            <div
              className={`w-5 h-5 rounded border-2 flex items-center justify-center transition ${
                includeUnassigned ? 'border-accent bg-accent' : 'border-subtle'
              }`}
            >
              {includeUnassigned && <div className="w-2 h-2 bg-white rounded-sm" />}
            </div>
            <span className="text-[9px] font-bold text-muted text-center leading-tight">
              Unassigned
            </span>
          </button>
        )}

        {/* Carrier options - only show available carriers */}
        {availableCarriers.map((carrier) => (
          <button
            key={carrier}
            onClick={() => onCarrierToggle(carrier)}
            className={`flex flex-col items-center gap-2 p-2 rounded-lg border-2 transition-all ${
              selectedCarriers.has(carrier)
                ? 'border-accent bg-accent/10'
                : 'border-subtle hover:border-accent/50'
            }`}
          >
            <div
              className={`w-5 h-5 rounded border-2 flex items-center justify-center transition ${
                selectedCarriers.has(carrier) ? 'border-accent bg-accent' : 'border-subtle'
              }`}
            >
              {selectedCarriers.has(carrier) && <div className="w-2 h-2 bg-white rounded-sm" />}
            </div>
            <div className="w-8 h-6 flex items-center justify-center">
              <TransportLogo
                company={carrier}
                plain
                textColor={getCarrierTextColor(carrier)}
                className="w-full h-full object-contain"
              />
            </div>
            <span className="text-[8px] font-bold text-muted text-center leading-tight">
              {carrier.length > 5 ? carrier.slice(0, 5) : carrier}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
};
