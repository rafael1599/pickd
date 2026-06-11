import { createPortal } from 'react-dom';
import X from 'lucide-react/dist/esm/icons/x';
import Truck from 'lucide-react/dist/esm/icons/truck';
import Package from 'lucide-react/dist/esm/icons/package';
import type { PickingList } from '../hooks/useDoubleCheckList';
import type { GroupType } from '../hooks/useOrderGroups';
import { useScrollLock } from '../../../hooks/useScrollLock';

interface GroupOrderModalProps {
  sourceOrder: PickingList;
  targetOrder: PickingList;
  /** Adding to an EXISTING group: type is fixed, show a single confirm button. */
  joinExisting?: boolean;
  onConfirm: (type: GroupType) => void;
  onCancel: () => void;
}

export const GroupOrderModal: React.FC<GroupOrderModalProps> = ({
  sourceOrder,
  targetOrder,
  joinExisting = false,
  onConfirm,
  onCancel,
}) => {
  useScrollLock(true, onCancel);
  const formatOrderNumber = (order: PickingList) =>
    `#${order.order_number || order.id.slice(-6).toUpperCase()}`;
  // Waiting orders must never be grouped by accident — call it out loudly.
  const waitingOrders = [sourceOrder, targetOrder].filter((o) => o.is_waiting_inventory);

  return createPortal(
    <div
      className="fixed inset-0 z-[150] flex items-center justify-center p-4 bg-main/60 backdrop-blur-md animate-in fade-in duration-150"
      onClick={onCancel}
    >
      <div
        className="bg-surface border border-subtle rounded-2xl w-full max-w-sm shadow-2xl overflow-hidden animate-in zoom-in-95 duration-150"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-4 border-b border-subtle flex items-center justify-between">
          <h3 className="text-base font-black text-content uppercase tracking-tight">
            Group Orders
          </h3>
          <button
            onClick={onCancel}
            className="p-1.5 -mr-1.5 text-muted hover:text-content transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <div className="flex items-center justify-center gap-3 py-2">
            <span className="px-3 py-1.5 bg-card border border-subtle rounded-xl text-xs font-black text-content uppercase tracking-tight">
              {formatOrderNumber(sourceOrder)}
            </span>
            <span className="text-muted text-xs font-bold">+</span>
            <span className="px-3 py-1.5 bg-card border border-subtle rounded-xl text-xs font-black text-content uppercase tracking-tight">
              {formatOrderNumber(targetOrder)}
            </span>
          </div>

          {waitingOrders.length > 0 && (
            <div className="text-center text-[11px] font-black uppercase tracking-wider text-amber-400 bg-amber-500/10 border border-amber-500/30 rounded-lg px-3 py-2">
              ⚠ {waitingOrders.map(formatOrderNumber).join(' and ')}{' '}
              {waitingOrders.length === 1 ? 'is' : 'are'} waiting for inventory
            </div>
          )}

          {joinExisting ? (
            <>
              <p className="text-[10px] text-muted font-bold uppercase tracking-widest text-center">
                Add to the existing group?
              </p>
              <button
                onClick={() => onConfirm('general')}
                className="w-full p-4 rounded-xl border-2 border-accent/30 bg-accent/10 hover:bg-accent/20 transition-all active:scale-95 text-sm font-black text-accent uppercase tracking-widest"
              >
                Add to group
              </button>
            </>
          ) : (
            <>
              <p className="text-[10px] text-muted font-bold uppercase tracking-widest text-center">
                Select group type
              </p>

              <div className="grid grid-cols-2 gap-3">
                <button
                  onClick={() => onConfirm('fedex')}
                  className="flex flex-col items-center gap-2 p-4 rounded-xl border-2 border-purple-500/20 bg-purple-500/5 hover:bg-purple-500/10 hover:border-purple-500/40 transition-all active:scale-95"
                >
                  <Truck size={24} className="text-purple-400" />
                  <span className="text-xs font-black text-purple-400 uppercase tracking-widest">
                    FedEx
                  </span>
                </button>

                <button
                  onClick={() => onConfirm('general')}
                  className="flex flex-col items-center gap-2 p-4 rounded-xl border-2 border-accent/20 bg-accent/5 hover:bg-accent/10 hover:border-accent/40 transition-all active:scale-95"
                >
                  <Package size={24} className="text-accent" />
                  <span className="text-xs font-black text-accent uppercase tracking-widest">
                    General
                  </span>
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
};
