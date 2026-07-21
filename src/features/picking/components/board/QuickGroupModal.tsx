import React, { useState } from 'react';
import { ModalOverlay } from '../../../../components/ui/ModalOverlay';
import X from 'lucide-react/dist/esm/icons/x';
import Search from 'lucide-react/dist/esm/icons/search';
import ChevronRight from 'lucide-react/dist/esm/icons/chevron-right';
import Check from 'lucide-react/dist/esm/icons/check';
import type { PickingList } from '../../hooks/useDoubleCheckList';
import { useParkedLocations } from '../../hooks/useParkedLocations';
import { useQuickGroup } from '../../hooks/useQuickGroup';
import { useOrderGroups } from '../../hooks/useOrderGroups';

interface QuickGroupModalProps {
  sourceOrder: PickingList;
  allCompletedOrders: PickingList[];
  onClose: () => void;
  /** needsShippingPrompt is true when the new group mixes FedEx + Regular
   *  orders from different customers — the caller should open
   *  ShippingResolutionModal for groupId. */
  onSuccess: (groupId: string, needsShippingPrompt: boolean) => void;
}

export const QuickGroupModal: React.FC<QuickGroupModalProps> = ({
  sourceOrder,
  allCompletedOrders,
  onClose,
  onSuccess,
}) => {
  const [step, setStep] = useState<'select' | 'location'>('select');
  const [selectedOrderIds, setSelectedOrderIds] = useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedLocation, setSelectedLocation] = useState<string>('');
  const [customLocation, setCustomLocation] = useState('');
  const [isGrouping, setIsGrouping] = useState(false);

  const { locations } = useParkedLocations();
  const { quickGroupCompletedOrders } = useQuickGroup();
  const { resolveMixedShippingType } = useOrderGroups();

  const candidates = allCompletedOrders.filter(
    (o) =>
      o.id !== sourceOrder.id &&
      o.status === 'completed' &&
      !o.is_shipped &&
      (!searchQuery || o.order_number?.includes(searchQuery))
  );

  const toggleOrderSelection = (orderId: string) => {
    const newSet = new Set(selectedOrderIds);
    if (newSet.has(orderId)) {
      newSet.delete(orderId);
    } else {
      newSet.add(orderId);
    }
    setSelectedOrderIds(newSet);
  };

  // Check if any selected order is PICK UP
  const hasPickupOrder = Array.from(selectedOrderIds).some((orderId) => {
    const order = allCompletedOrders.find((o) => o.id === orderId);
    return order?.transport_company === 'PICK UP';
  });

  const handleNext = () => {
    if (hasPickupOrder) {
      setStep('location');
    } else {
      // No PICK UP orders, group directly
      handleGroup();
    }
  };

  const handleGroup = async () => {
    if (selectedOrderIds.size === 0) return;

    setIsGrouping(true);
    try {
      const orderIds = [sourceOrder.id, ...Array.from(selectedOrderIds)];
      const finalLocation = hasPickupOrder ? customLocation || selectedLocation : '';
      const groupId = await quickGroupCompletedOrders(orderIds, finalLocation);

      if (groupId) {
        // This RPC always creates a 'general' group and never touches
        // shipping_type — a FedEx+Regular mix (different customers) must
        // still be resolved explicitly, same as every other combine path.
        const resolution = await resolveMixedShippingType(groupId);
        onSuccess(groupId, resolution === 'needs-prompt');
        onClose();
      }
    } finally {
      setIsGrouping(false);
    }
  };

  const currentLocation = customLocation || selectedLocation;
  const isSelectReady = selectedOrderIds.size > 0;
  const isLocationReady = hasPickupOrder ? currentLocation : true;

  return (
    <ModalOverlay onClose={onClose} maxWidth="md">
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-black text-content uppercase tracking-tight">
            {step === 'select' ? 'Select Orders' : 'Parked Location'}
          </h2>
          <button onClick={onClose} className="text-muted hover:text-content">
            <X size={20} />
          </button>
        </div>

        {/* Step 1: Select Orders */}
        {step === 'select' && (
          <>
            {/* Source order info */}
            <div className="bg-tertiary p-3 rounded-lg border border-subtle">
              <p className="text-xs text-muted">Starting Order</p>
              <p className="text-sm font-semibold text-content">
                #{sourceOrder.order_number || sourceOrder.id.slice(-6).toUpperCase()}
              </p>
            </div>

            {/* Search */}
            <div className="space-y-2">
              <label className="text-xs font-semibold text-muted uppercase">Add More Orders</label>
              <div className="relative">
                <Search size={16} className="absolute left-3 top-2.5 text-muted" />
                <input
                  type="text"
                  placeholder="Search order..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-9 pr-3 py-2 bg-secondary border border-subtle rounded text-sm text-content placeholder:text-muted focus:outline-none focus:border-accent"
                />
              </div>
            </div>

            {/* Order list with checkboxes */}
            <div className="space-y-2 max-h-48 overflow-y-auto bg-tertiary rounded p-3 border border-subtle">
              {candidates.length === 0 ? (
                <p className="text-xs text-muted text-center py-4">No other completed orders</p>
              ) : (
                candidates.map((order) => (
                  <button
                    key={order.id}
                    onClick={() => toggleOrderSelection(order.id)}
                    className="w-full flex items-center gap-3 px-3 py-2 rounded text-xs transition hover:bg-secondary"
                  >
                    <div
                      className={`w-4 h-4 rounded border transition flex items-center justify-center shrink-0 ${
                        selectedOrderIds.has(order.id)
                          ? 'bg-accent border-accent'
                          : 'border-subtle hover:border-accent'
                      }`}
                    >
                      {selectedOrderIds.has(order.id) && <Check size={12} className="text-white" />}
                    </div>
                    <span className="flex-1 text-left text-content font-medium">
                      #{order.order_number || order.id.slice(-6).toUpperCase()}
                    </span>
                    {order.transport_company === 'PICK UP' && (
                      <span className="text-[10px] bg-red-500/20 text-red-400 px-2 py-0.5 rounded font-semibold">
                        PICKUP
                      </span>
                    )}
                  </button>
                ))
              )}
            </div>

            {/* Summary */}
            {selectedOrderIds.size > 0 && (
              <div className="bg-tertiary p-3 rounded-lg border border-subtle text-xs text-muted">
                <p>
                  Grouping{' '}
                  <span className="text-content font-semibold">
                    {selectedOrderIds.size + 1} orders
                  </span>
                  {hasPickupOrder && (
                    <>
                      {' '}
                      (includes <span className="text-red-400 font-semibold">PICK UP</span>)
                    </>
                  )}
                </p>
              </div>
            )}

            {/* Actions */}
            <div className="flex gap-2 justify-end pt-2">
              <button
                onClick={onClose}
                className="px-3 py-2 rounded text-xs font-semibold text-content bg-secondary border border-subtle hover:bg-tertiary transition"
              >
                Cancel
              </button>
              <button
                onClick={handleNext}
                disabled={!isSelectReady || isGrouping}
                className={`px-4 py-2 rounded text-xs font-semibold transition flex items-center gap-2 ${
                  isSelectReady && !isGrouping
                    ? 'bg-accent text-accent-content hover:opacity-90 cursor-pointer'
                    : 'bg-muted text-muted-foreground cursor-not-allowed opacity-50'
                }`}
              >
                {hasPickupOrder ? 'Next' : 'Group'} <ChevronRight size={14} />
              </button>
            </div>
          </>
        )}

        {/* Step 2: Location (only if has PICK UP) */}
        {step === 'location' && hasPickupOrder && (
          <>
            {/* Selected orders summary */}
            <div className="bg-tertiary p-3 rounded-lg border border-subtle space-y-2">
              <p className="text-xs text-muted">Selected Orders</p>
              <div className="flex flex-wrap gap-2">
                <span className="text-xs bg-accent/20 text-accent px-2 py-1 rounded font-semibold">
                  #{sourceOrder.order_number || sourceOrder.id.slice(-6).toUpperCase()}
                </span>
                {Array.from(selectedOrderIds).map((orderId) => {
                  const order = allCompletedOrders.find((o) => o.id === orderId);
                  return (
                    <span
                      key={orderId}
                      className="text-xs bg-accent/20 text-accent px-2 py-1 rounded font-semibold"
                    >
                      #{order?.order_number || orderId.slice(-6).toUpperCase()}
                    </span>
                  );
                })}
              </div>
            </div>

            {/* Location selection */}
            <div className="space-y-2">
              <label className="text-xs font-semibold text-muted uppercase">Parked Location</label>
              <div className="grid grid-cols-3 gap-2">
                {locations.map((loc) => (
                  <button
                    key={loc}
                    onClick={() => {
                      setSelectedLocation(loc);
                      setCustomLocation('');
                    }}
                    className={`px-2 py-2 rounded text-xs font-semibold transition ${
                      selectedLocation === loc && !customLocation
                        ? 'bg-accent text-accent-content'
                        : 'bg-secondary border border-subtle text-content hover:border-accent'
                    }`}
                  >
                    {loc}
                  </button>
                ))}
              </div>
              <div>
                <input
                  type="text"
                  placeholder="Or enter custom location..."
                  value={customLocation}
                  onChange={(e) => setCustomLocation(e.target.value.toUpperCase())}
                  className="w-full px-3 py-2 bg-secondary border border-subtle rounded text-xs text-content placeholder:text-muted focus:outline-none focus:border-accent"
                />
              </div>
            </div>

            {/* Actions */}
            <div className="flex gap-2 justify-between pt-2">
              <button
                onClick={() => setStep('select')}
                className="px-3 py-2 rounded text-xs font-semibold text-content bg-secondary border border-subtle hover:bg-tertiary transition"
              >
                Back
              </button>
              <div className="flex gap-2">
                <button
                  onClick={onClose}
                  className="px-3 py-2 rounded text-xs font-semibold text-content bg-secondary border border-subtle hover:bg-tertiary transition"
                >
                  Cancel
                </button>
                <button
                  onClick={handleGroup}
                  disabled={!isLocationReady || isGrouping}
                  className={`px-4 py-2 rounded text-xs font-semibold transition ${
                    isLocationReady && !isGrouping
                      ? 'bg-accent text-accent-content hover:opacity-90 cursor-pointer'
                      : 'bg-muted text-muted-foreground cursor-not-allowed opacity-50'
                  }`}
                >
                  {isGrouping ? 'Grouping...' : 'Group Orders'}
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </ModalOverlay>
  );
};
