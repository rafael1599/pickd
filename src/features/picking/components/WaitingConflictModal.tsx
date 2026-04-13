// idea-053: Blocking modal shown when a new order's items conflict with
// waiting orders (cross-customer SKU reservation).
//
// Actions:
//   - Take Over: steal the SKU from the waiting order (admin-only RPC)
//   - Edit Order: open CorrectionModeView to remove/replace the item
//   - Dismiss: acknowledge the conflict and proceed anyway
//
// Shown automatically when DoubleCheckView detects conflicts via
// useWaitingConflicts. Can be dismissed — a warning banner remains.

import React from 'react';
import { createPortal } from 'react-dom';
import AlertTriangle from 'lucide-react/dist/esm/icons/alert-triangle';
import ArrowRightLeft from 'lucide-react/dist/esm/icons/arrow-right-left';
import Pencil from 'lucide-react/dist/esm/icons/pencil';
import X from 'lucide-react/dist/esm/icons/x';
import type { WaitingConflict } from '../hooks/useWaitingConflicts';

interface WaitingConflictModalProps {
  conflicts: WaitingConflict[];
  isAdmin: boolean;
  onTakeOver: (conflict: WaitingConflict) => void;
  isTakingOver: boolean;
  onEditOrder: () => void;
  onDismiss: () => void;
}

export const WaitingConflictModal: React.FC<WaitingConflictModalProps> = ({
  conflicts,
  isAdmin,
  onTakeOver,
  isTakingOver,
  onEditOrder,
  onDismiss,
}) => {
  return createPortal(
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-main/70 backdrop-blur-md animate-in fade-in duration-200">
      <div
        className="bg-surface border border-amber-500/30 rounded-3xl w-full max-w-md shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-5 py-4 bg-amber-500/10 border-b border-amber-500/20 flex items-center gap-3">
          <div className="p-2 rounded-xl bg-amber-500/20">
            <AlertTriangle size={20} className="text-amber-500" />
          </div>
          <div className="flex-1">
            <h3 className="text-sm font-black text-amber-500 uppercase tracking-tight">
              SKU Conflict
            </h3>
            <p className="text-[10px] text-amber-500/70 font-bold">
              {conflicts.length === 1 ? '1 item' : `${conflicts.length} items`} reserved by waiting {conflicts.length === 1 ? 'order' : 'orders'}
            </p>
          </div>
          <button
            onClick={onDismiss}
            className="p-2 -mr-2 text-muted hover:text-content transition-colors"
            title="Dismiss and proceed"
          >
            <X size={20} />
          </button>
        </div>

        {/* Conflict list */}
        <div className="p-4 space-y-3 max-h-[40vh] overflow-y-auto">
          {conflicts.map((c) => (
            <div
              key={`${c.sku}-${c.waitingListId}`}
              className="p-3 rounded-2xl border border-amber-500/15 bg-card space-y-2"
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-black text-content uppercase tracking-tight">
                  {c.sku}
                </span>
                <span className="text-[10px] font-bold text-amber-500 bg-amber-500/10 px-2 py-0.5 rounded-lg">
                  needs {c.myQty} — waiting holds {c.waitingQty}
                </span>
              </div>
              <p className="text-[10px] text-muted font-bold">
                Reserved by order <span className="text-content">#{c.waitingOrderNumber}</span> for{' '}
                <span className="text-content">{c.waitingCustomerName}</span>
              </p>
              {isAdmin && (
                <button
                  onClick={() => onTakeOver(c)}
                  disabled={isTakingOver}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-[10px] font-black uppercase tracking-wider text-purple-400 bg-purple-500/10 border border-purple-500/30 rounded-xl hover:bg-purple-500/20 transition-all active:scale-95 disabled:opacity-40"
                >
                  <ArrowRightLeft size={12} />
                  {isTakingOver ? 'Taking over...' : 'Take Over from Waiting'}
                </button>
              )}
            </div>
          ))}
        </div>

        {/* Footer actions */}
        <div className="p-4 border-t border-subtle flex gap-2">
          <button
            onClick={onEditOrder}
            className="flex-1 flex items-center justify-center gap-2 p-3 rounded-xl text-xs font-black uppercase tracking-wider text-content bg-card border border-subtle hover:border-accent/30 transition-all active:scale-[0.98]"
          >
            <Pencil size={14} />
            Edit My Order
          </button>
          <button
            onClick={onDismiss}
            className="flex-1 p-3 rounded-xl text-xs font-black uppercase tracking-wider text-muted bg-card border border-subtle hover:border-subtle/80 transition-all active:scale-[0.98]"
          >
            Proceed Anyway
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
};
