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
  showWaitingFilter?: boolean;
  isWaitingFilterActive?: boolean;
  waitingCount?: number;
  onWaitingToggle?: () => void;
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
  showWaitingFilter,
  isWaitingFilterActive,
  waitingCount,
  onWaitingToggle,
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
    <div className="space-y-2 p-2.5 bg-tertiary rounded-lg border border-subtle">
      <div className="flex items-center justify-between">
        <p className="text-[10px] font-semibold text-muted uppercase">Filter by Carrier</p>
        <button
          onClick={handleSelectAll}
          className="text-[10px] font-semibold text-accent hover:text-accent/80 transition"
        >
          {allSelected ? 'Clear All' : 'Select All'}
        </button>
      </div>

      <div className="flex flex-wrap gap-1">
        {/* Waiting filter option - only show if there are waiting orders */}
        {showWaitingFilter && (waitingCount ?? 0) > 0 && (
          <button
            onClick={onWaitingToggle}
            className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-md border transition-all ${
              isWaitingFilterActive
                ? 'border-amber-500 bg-amber-500/10 text-amber-400 font-bold'
                : 'border-subtle hover:border-amber-500/50 text-muted'
            }`}
            title="Show orders waiting for inventory"
          >
            <div
              className={`w-3 h-3 rounded-sm border flex items-center justify-center transition shrink-0 ${
                isWaitingFilterActive ? 'border-amber-500 bg-amber-500' : 'border-subtle'
              }`}
            >
              {isWaitingFilterActive && <div className="w-1 h-1 bg-white rounded-sm" />}
            </div>
            <span className="text-[9px] font-bold uppercase tracking-wider">Waiting</span>
            {waitingCount !== undefined && (
              <span className="text-[9px] opacity-70">({waitingCount})</span>
            )}
          </button>
        )}
        {/* Unassigned option - only show if there are unassigned orders */}
        {hasUnassignedOrders && (
          <button
            onClick={() => onUnassignedToggle(!includeUnassigned)}
            className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-md border transition-all ${
              includeUnassigned
                ? 'border-accent bg-accent/10'
                : 'border-subtle hover:border-accent/50'
            }`}
            title="Unassigned"
          >
            <div
              className={`w-3 h-3 rounded-sm border flex items-center justify-center transition shrink-0 ${
                includeUnassigned ? 'border-accent bg-accent' : 'border-subtle'
              }`}
            >
              {includeUnassigned && <div className="w-1 h-1 bg-white rounded-sm" />}
            </div>
            <span className="text-[9px] font-bold text-muted uppercase tracking-wider">
              Unassigned
            </span>
            <span className="text-[9px] text-muted/60">{unassignedCount}</span>
          </button>
        )}

        {/* Carrier options - only show available carriers */}
        {availableCarriers.map((carrier) => (
          <button
            key={carrier}
            onClick={() => onCarrierToggle(carrier)}
            className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-md border transition-all ${
              selectedCarriers.has(carrier)
                ? 'border-accent bg-accent/10'
                : 'border-subtle hover:border-accent/50'
            }`}
            title={carrier}
          >
            <div
              className={`w-3 h-3 rounded-sm border flex items-center justify-center transition shrink-0 ${
                selectedCarriers.has(carrier) ? 'border-accent bg-accent' : 'border-subtle'
              }`}
            >
              {selectedCarriers.has(carrier) && <div className="w-1 h-1 bg-white rounded-sm" />}
            </div>
            <div className="w-5 h-3.5 flex items-center justify-center shrink-0">
              <TransportLogo
                company={carrier}
                plain
                textColor={getCarrierTextColor(carrier)}
                className="w-full h-full object-contain"
              />
            </div>
            <span className="text-[9px] text-muted/60">{carrierCounts.get(carrier) ?? 0}</span>
          </button>
        ))}
      </div>
    </div>
  );
};
