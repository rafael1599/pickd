import React, { useState } from 'react';
import { ModalOverlay } from '../../../../components/ui/ModalOverlay';
import X from 'lucide-react/dist/esm/icons/x';
import Search from 'lucide-react/dist/esm/icons/search';
import type { PickingList } from '../../hooks/useDoubleCheckList';
import { useParkedLocations } from '../../hooks/useParkedLocations';
import { useQuickGroup } from '../../hooks/useQuickGroup';

interface QuickGroupModalProps {
  sourceOrder: PickingList;
  allCompletedOrders: PickingList[];
  onClose: () => void;
  onSuccess: () => void;
}

export const QuickGroupModal: React.FC<QuickGroupModalProps> = ({
  sourceOrder,
  allCompletedOrders,
  onClose,
  onSuccess,
}) => {
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);
  const [selectedLocation, setSelectedLocation] = useState<string>('');
  const [customLocation, setCustomLocation] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [isGrouping, setIsGrouping] = useState(false);

  const { locations } = useParkedLocations();
  const { quickGroupCompletedOrders } = useQuickGroup();

  const candidates = allCompletedOrders.filter(
    (o) =>
      o.id !== sourceOrder.id &&
      o.status === 'completed' &&
      !o.is_shipped &&
      (!searchQuery || o.order_number?.includes(searchQuery))
  );

  const handleGroup = async () => {
    if (!selectedOrderId || !selectedLocation) {
      return;
    }

    setIsGrouping(true);
    try {
      const finalLocation = customLocation || selectedLocation;
      const groupId = await quickGroupCompletedOrders(
        [sourceOrder.id, selectedOrderId],
        finalLocation
      );

      if (groupId) {
        onSuccess();
        onClose();
      }
    } finally {
      setIsGrouping(false);
    }
  };

  const currentLocation = customLocation || selectedLocation;
  const isReady = selectedOrderId && currentLocation;

  return (
    <ModalOverlay onClose={onClose} maxWidth="md">
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-black text-content uppercase tracking-tight">
            Quick Group Completed Orders
          </h2>
          <button onClick={onClose} className="text-muted hover:text-content">
            <X size={20} />
          </button>
        </div>

        {/* Source order info */}
        <div className="bg-tertiary p-3 rounded-lg border border-subtle">
          <p className="text-xs text-muted">Source Order</p>
          <p className="text-sm font-semibold text-content">
            #{sourceOrder.order_number || sourceOrder.id.slice(-6).toUpperCase()}
          </p>
        </div>

        {/* Target order search & select */}
        <div className="space-y-2">
          <label className="text-xs font-semibold text-muted uppercase">Group With</label>
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
          <div className="max-h-40 overflow-y-auto space-y-1 bg-tertiary rounded p-2 border border-subtle">
            {candidates.length === 0 ? (
              <p className="text-xs text-muted text-center py-4">No other completed orders</p>
            ) : (
              candidates.map((order) => (
                <button
                  key={order.id}
                  onClick={() => setSelectedOrderId(order.id)}
                  className={`w-full text-left px-2 py-1 rounded text-xs transition ${
                    selectedOrderId === order.id
                      ? 'bg-accent text-accent-content font-semibold'
                      : 'hover:bg-secondary text-content'
                  }`}
                >
                  #{order.order_number || order.id.slice(-6).toUpperCase()}
                </button>
              ))
            )}
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

        {/* Summary */}
        {selectedOrderId && currentLocation && (
          <div className="bg-tertiary p-3 rounded-lg border border-subtle text-xs text-muted">
            <p>
              Grouping orders{' '}
              <span className="text-content font-semibold">
                #{sourceOrder.order_number || '...'}
              </span>{' '}
              +{' '}
              <span className="text-content font-semibold">
                #{allCompletedOrders.find((o) => o.id === selectedOrderId)?.order_number || '...'}
              </span>{' '}
              at <span className="text-content font-semibold">{currentLocation}</span>
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
            onClick={handleGroup}
            disabled={!isReady || isGrouping}
            className={`px-4 py-2 rounded text-xs font-semibold transition ${
              isReady && !isGrouping
                ? 'bg-accent text-accent-content hover:opacity-90 cursor-pointer'
                : 'bg-muted text-muted-foreground cursor-not-allowed opacity-50'
            }`}
          >
            {isGrouping ? 'Grouping...' : 'Quick Group'}
          </button>
        </div>
      </div>
    </ModalOverlay>
  );
};
