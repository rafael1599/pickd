import React from 'react';
import AlertTriangle from 'lucide-react/dist/esm/icons/alert-triangle';
import type { ZeroStockLine } from '../utils/zeroStockPrompt';

export interface ConfirmZeroStockModalProps {
  isOpen: boolean;
  lines: ZeroStockLine[];
  onConfirm: () => void;
  onCancel: () => void;
}

export const ConfirmZeroStockModal: React.FC<ConfirmZeroStockModalProps> = ({
  isOpen,
  lines,
  onConfirm,
  onCancel,
}) => {
  if (!isOpen) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-zero-stock-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-in fade-in duration-200"
    >
      <div
        className="w-full max-w-md bg-[#161920] border border-[#2A2F36] rounded-2xl p-5 shadow-2xl flex flex-col gap-4 animate-in zoom-in-95 duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-amber-500/15 border border-amber-500/30 flex items-center justify-center shrink-0">
            <AlertTriangle className="text-amber-400" size={20} />
          </div>
          <div className="min-w-0 flex-1">
            <h2
              id="confirm-zero-stock-title"
              className="text-base font-black text-white uppercase tracking-wider leading-snug"
            >
              Missing Stock Confirmation
            </h2>
            <p className="text-[11px] text-muted leading-tight mt-0.5">
              The following lines were not picked. Completing the order will set their shelf stock
              to 0:
            </p>
          </div>
        </div>

        <div className="flex flex-col gap-2 max-h-60 overflow-y-auto py-1">
          {lines.map((line) => (
            <div
              key={`${line.sku}|${line.location}`}
              className="flex items-center justify-between p-3 bg-surface/40 border border-subtle/50 rounded-xl text-xs"
            >
              <div className="flex flex-col">
                <span className="font-mono font-bold text-white tracking-tight">
                  {line.sku} · {line.location}
                </span>
              </div>
              <span className="text-[11px] font-bold text-amber-400">
                system has {line.systemQty} → will be set to 0
              </span>
            </div>
          ))}
        </div>

        <div className="flex items-center gap-2 pt-2 border-t border-subtle">
          <button
            type="button"
            onClick={onCancel}
            className="flex-1 min-h-12 rounded-xl font-black uppercase tracking-widest text-[10px] bg-card text-muted border border-subtle transition-all hover:bg-card active:scale-[0.97]"
          >
            Back
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="flex-1 min-h-12 rounded-xl font-black uppercase tracking-widest text-[10px] bg-amber-500 text-black border border-amber-500 transition-all hover:bg-amber-400 active:scale-[0.97]"
          >
            Confirm
          </button>
        </div>
      </div>
    </div>
  );
};
