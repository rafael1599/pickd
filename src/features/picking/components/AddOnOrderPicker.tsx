import { createPortal } from 'react-dom';
import X from 'lucide-react/dist/esm/icons/x';
import Package from 'lucide-react/dist/esm/icons/package';
import Loader2 from 'lucide-react/dist/esm/icons/loader-2';
import { useScrollLock } from '../../../hooks/useScrollLock';

export interface AddOnCandidateOrder {
  id: string;
  order_number: string | null;
  status: string;
  total_units: number | null;
  items: unknown[] | null;
}

interface AddOnOrderPickerProps {
  sourceOrder: { id: string; order_number: string | null };
  candidates: AddOnCandidateOrder[];
  submitting: boolean;
  onSelect: (targetId: string) => void;
  onCancel: () => void;
}

const formatOrderNumber = (o: { id: string; order_number: string | null }) =>
  `#${o.order_number || o.id.slice(-6).toUpperCase()}`;

export const AddOnOrderPicker: React.FC<AddOnOrderPickerProps> = ({
  sourceOrder,
  candidates,
  submitting,
  onSelect,
  onCancel,
}) => {
  useScrollLock(true, submitting ? () => {} : onCancel);

  return createPortal(
    <div
      className="fixed inset-0 z-[150] flex items-center justify-center p-4 bg-main/60 backdrop-blur-md animate-in fade-in duration-150"
      onClick={submitting ? undefined : onCancel}
    >
      <div
        className="bg-surface border border-subtle rounded-2xl w-full max-w-md shadow-2xl overflow-hidden animate-in zoom-in-95 duration-150"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-4 border-b border-subtle flex items-center justify-between">
          <div>
            <h3 className="text-base font-black text-content uppercase tracking-tight">
              Select Add-On Order
            </h3>
            <p className="text-[10px] text-muted font-bold uppercase tracking-widest mt-1">
              Combine with {formatOrderNumber(sourceOrder)}
            </p>
          </div>
          <button
            onClick={onCancel}
            disabled={submitting}
            className="p-1.5 -mr-1.5 text-muted hover:text-content transition-colors disabled:opacity-50"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 max-h-[60vh] overflow-y-auto">
          {candidates.length === 0 ? (
            <p className="text-xs text-muted font-bold uppercase tracking-widest text-center py-8">
              No open orders found for this customer
            </p>
          ) : (
            <div className="space-y-2">
              {candidates.map((c) => {
                const itemCount = Array.isArray(c.items) ? c.items.length : 0;
                return (
                  <button
                    key={c.id}
                    onClick={() => onSelect(c.id)}
                    disabled={submitting}
                    className="w-full flex items-center justify-between gap-3 p-3 rounded-xl border border-subtle bg-card hover:bg-card/80 hover:border-accent/40 transition-all active:scale-[0.99] text-left disabled:opacity-50"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <Package size={18} className="text-accent shrink-0" />
                      <div className="min-w-0">
                        <div className="text-xs font-black text-content uppercase tracking-tight truncate">
                          {formatOrderNumber(c)}
                        </div>
                        <div className="text-[10px] text-muted font-bold uppercase tracking-widest mt-0.5 truncate">
                          {c.status.replace(/_/g, ' ')} · {itemCount} sku · {c.total_units ?? 0}{' '}
                          units
                        </div>
                      </div>
                    </div>
                    {submitting && <Loader2 className="w-4 h-4 animate-spin text-muted shrink-0" />}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
};
