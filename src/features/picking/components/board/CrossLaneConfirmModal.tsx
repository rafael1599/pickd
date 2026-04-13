import React from 'react';
import { createPortal } from 'react-dom';
import ArrowRight from 'lucide-react/dist/esm/icons/arrow-right';

interface CrossLaneConfirmModalProps {
  orderNumber: string;
  fromType: string;
  toType: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export const CrossLaneConfirmModal: React.FC<CrossLaneConfirmModalProps> = ({
  orderNumber,
  fromType,
  toType,
  onConfirm,
  onCancel,
}) => {
  const fromLabel = fromType === 'fedex' ? 'FedEx' : 'Regular';
  const toLabel = toType === 'fedex' ? 'FedEx' : 'Regular';
  const fromColor = fromType === 'fedex' ? 'text-purple-400' : 'text-emerald-400';
  const toColor = toType === 'fedex' ? 'text-purple-400' : 'text-emerald-400';

  return createPortal(
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-main/70 backdrop-blur-md animate-in fade-in duration-150"
      onClick={onCancel}
    >
      <div
        className="bg-surface border border-subtle rounded-2xl w-full max-w-xs shadow-2xl overflow-hidden animate-in zoom-in-95 duration-150 p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <p className="text-xs font-black text-content uppercase tracking-tight mb-3">
          Reclassify Order #{orderNumber}?
        </p>

        <div className="flex items-center justify-center gap-3 py-3">
          <span className={`text-sm font-black uppercase ${fromColor}`}>{fromLabel}</span>
          <ArrowRight size={16} className="text-muted" />
          <span className={`text-sm font-black uppercase ${toColor}`}>{toLabel}</span>
        </div>

        <p className="text-[10px] text-muted text-center mb-4">
          This order was originally classified as {fromLabel}. Changing its shipping type will move
          it to the {toLabel} lane.
        </p>

        <div className="flex gap-2">
          <button
            onClick={onCancel}
            className="flex-1 p-2.5 rounded-xl text-xs font-black uppercase tracking-wider text-muted bg-card border border-subtle hover:border-subtle/80 transition-all active:scale-[0.98]"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className="flex-1 p-2.5 rounded-xl text-xs font-black uppercase tracking-wider text-white bg-accent hover:bg-accent/90 transition-all active:scale-[0.98]"
          >
            Move
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
};
