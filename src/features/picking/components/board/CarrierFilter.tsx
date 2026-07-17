import React from 'react';
import { TransportLogo } from '../../../../components/orders/TransportLogo';
import { getCarrierTextColor } from '../../../../components/orders/transportLogos';

interface CarrierFilterProps {
  selectedCarriers: Set<string>;
  includeUnassigned: boolean;
  hasUnassignedOrders: boolean;
  availableCarriers: string[];
  carrierCounts: Map<string, number>;
  unassignedCount: number;
  onCarrierToggle: (carrier: string) => void;
  onUnassignedToggle: (include: boolean) => void;
}

export const CarrierFilter: React.FC<CarrierFilterProps> = ({
  selectedCarriers,
  includeUnassigned,
  hasUnassignedOrders,
  availableCarriers,
  carrierCounts,
  unassignedCount,
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

      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-1">
        {/* Unassigned option - only show if there are unassigned orders */}
        {hasUnassignedOrders && (
          <button
            onClick={() => onUnassignedToggle(!includeUnassigned)}
            className={`flex items-center justify-center p-2 rounded-lg border-2 transition-all ${
              includeUnassigned
                ? 'border-accent bg-accent/10'
                : 'border-subtle hover:border-accent/50'
            }`}
            title="Unassigned"
          >
            <div className="flex items-center gap-2">
              <div
                className={`w-4 h-4 rounded border-2 flex items-center justify-center transition shrink-0 ${
                  includeUnassigned ? 'border-accent bg-accent' : 'border-subtle'
                }`}
              >
                {includeUnassigned && <div className="w-1.5 h-1.5 bg-white rounded-sm" />}
              </div>
              <div className="flex flex-col items-start">
                <span className="text-[10px] font-bold text-muted uppercase tracking-wider">
                  Unassigned
                </span>
                <span className="text-[9px] text-muted/60">{unassignedCount}</span>
              </div>
            </div>
          </button>
        )}

        {/* Carrier options - only show available carriers */}
        {availableCarriers.map((carrier) => (
          <button
            key={carrier}
            onClick={() => onCarrierToggle(carrier)}
            className={`flex items-center justify-center p-2 rounded-lg border-2 transition-all ${
              selectedCarriers.has(carrier)
                ? 'border-accent bg-accent/10'
                : 'border-subtle hover:border-accent/50'
            }`}
            title={carrier}
          >
            <div className="flex items-center gap-2">
              <div
                className={`w-4 h-4 rounded border-2 flex items-center justify-center transition shrink-0 ${
                  selectedCarriers.has(carrier) ? 'border-accent bg-accent' : 'border-subtle'
                }`}
              >
                {selectedCarriers.has(carrier) && (
                  <div className="w-1.5 h-1.5 bg-white rounded-sm" />
                )}
              </div>
              <div className="flex flex-col items-start">
                <div className="w-6 h-5 flex items-center justify-center">
                  <TransportLogo
                    company={carrier}
                    plain
                    textColor={getCarrierTextColor(carrier)}
                    className="w-full h-full object-contain"
                  />
                </div>
                <span className="text-[9px] text-muted/60">{carrierCounts.get(carrier) ?? 0}</span>
              </div>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
};
