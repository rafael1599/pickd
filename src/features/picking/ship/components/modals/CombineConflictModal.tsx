import React, { useState } from 'react';
import { MapPin, Truck, AlertTriangle, Check } from 'lucide-react';
import { ModalOverlay } from '../../../../../components/ui/ModalOverlay';
import type { CombineConflictAnalysis } from '../../utils/combineConflicts';

export interface CombineConflictModalProps {
  conflict: CombineConflictAnalysis;
  onConfirm: (resolution: {
    selectedAddressId?: string;
    selectedLoadNumber?: string;
  }) => Promise<void> | void;
  onClose: () => void;
}

export const CombineConflictModal: React.FC<CombineConflictModalProps> = ({
  conflict,
  onConfirm,
  onClose,
}) => {
  const [selectedAddressId, setSelectedAddressId] = useState<string>(
    conflict.defaultAddressId ?? ''
  );
  const [selectedLoadMode, setSelectedLoadMode] = useState<'preset' | 'custom'>(
    conflict.loadOptions.length > 0 ? 'preset' : 'custom'
  );
  const [selectedPresetLoad, setSelectedPresetLoad] = useState<string>(
    conflict.defaultLoadNumber ?? ''
  );
  const [customLoad, setCustomLoad] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const effectiveLoadNumber =
    selectedLoadMode === 'custom'
      ? customLoad.trim() || undefined
      : selectedPresetLoad.trim() || undefined;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (conflict.hasAddressConflict && !selectedAddressId) return;

    setIsSubmitting(true);
    try {
      await onConfirm({
        selectedAddressId: selectedAddressId || undefined,
        selectedLoadNumber: effectiveLoadNumber,
      });
      onClose();
    } catch (err) {
      console.error('[CombineConflictModal] Confirm error:', err);
      setIsSubmitting(false);
    }
  };

  return (
    <ModalOverlay
      onClose={onClose}
      maxWidth="md"
      zIndex={250}
      className="p-0 overflow-hidden flex flex-col max-h-[calc(100dvh-2rem)]"
    >
      <form onSubmit={handleSubmit} className="flex flex-col min-h-0 flex-1">
        {/* Header */}
        <div className="p-3.5 sm:p-4 border-b border-subtle flex items-start gap-3 bg-slate-50 dark:bg-slate-900/50 shrink-0">
          <div className="w-9 h-9 rounded-xl bg-amber-500/10 text-amber-600 dark:text-amber-500 flex items-center justify-center shrink-0 mt-0.5">
            <AlertTriangle className="w-4 h-4" />
          </div>
          <div className="min-w-0">
            <h3 className="text-sm sm:text-base font-semibold text-slate-900 dark:text-slate-100">
              Resolve Combine Conflict
            </h3>
            <p className="text-xs text-slate-600 dark:text-slate-400 mt-0.5 leading-relaxed">
              The orders being combined have differing details. Select the final values for the
              shared shipment:
            </p>
          </div>
        </div>

        {/* Body */}
        <div className="p-3.5 sm:p-4 space-y-4 overflow-y-auto flex-1 min-h-0">
          {/* Address Conflict */}
          {conflict.hasAddressConflict && (
            <div className="space-y-2">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                <MapPin className="w-3.5 h-3.5 text-accent" />
                <span>Shared Destination Address</span>
              </div>
              <div className="space-y-2">
                {conflict.addressOptions.map((opt) => {
                  const isSelected = selectedAddressId === opt.addressId;
                  return (
                    <button
                      key={opt.addressId}
                      type="button"
                      onClick={() => setSelectedAddressId(opt.addressId)}
                      className={`w-full text-left p-3 rounded-xl border transition-all flex items-start justify-between gap-3 cursor-pointer ${
                        isSelected
                          ? 'border-accent bg-emerald-500/10 dark:bg-emerald-500/15 ring-1 ring-accent'
                          : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 hover:border-slate-300 dark:hover:border-slate-700'
                      }`}
                    >
                      <div className="space-y-1 min-w-0">
                        <div className="text-sm font-medium text-slate-900 dark:text-slate-100 truncate">
                          {opt.street}
                        </div>
                        {(opt.city || opt.state || opt.zip) && (
                          <div className="text-xs text-slate-600 dark:text-slate-400">
                            {[opt.city, opt.state, opt.zip].filter(Boolean).join(', ')}
                          </div>
                        )}
                        <div className="flex flex-wrap gap-1 mt-1">
                          {opt.orderNumbers.map((num) => (
                            <span
                              key={num}
                              className="px-1.5 py-0.5 text-[10px] font-mono rounded bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700"
                            >
                              #{num}
                            </span>
                          ))}
                        </div>
                      </div>
                      <div
                        className={`w-5 h-5 rounded-full border shrink-0 flex items-center justify-center transition-colors ${
                          isSelected
                            ? 'border-accent bg-accent text-white'
                            : 'border-slate-300 dark:border-slate-700 bg-transparent'
                        }`}
                      >
                        {isSelected && <Check className="w-3 h-3 stroke-[3]" />}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Load Number Conflict */}
          {conflict.hasLoadNumberConflict && (
            <div className="space-y-2">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                <Truck className="w-3.5 h-3.5 text-accent" />
                <span>Load Number (Load #)</span>
              </div>
              <div className="space-y-2">
                {conflict.loadOptions.map((opt) => {
                  const isSelected =
                    selectedLoadMode === 'preset' && selectedPresetLoad === opt.loadNumber;
                  return (
                    <button
                      key={opt.loadNumber}
                      type="button"
                      onClick={() => {
                        setSelectedLoadMode('preset');
                        setSelectedPresetLoad(opt.loadNumber);
                      }}
                      className={`w-full text-left p-3 rounded-xl border transition-all flex items-center justify-between gap-3 cursor-pointer ${
                        isSelected
                          ? 'border-accent bg-emerald-500/10 dark:bg-emerald-500/15 ring-1 ring-accent'
                          : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 hover:border-slate-300 dark:hover:border-slate-700'
                      }`}
                    >
                      <div className="space-y-1 min-w-0">
                        <div className="text-sm font-mono font-medium text-slate-900 dark:text-slate-100">
                          {opt.loadNumber}
                        </div>
                        <div className="flex flex-wrap gap-1">
                          {opt.orderNumbers.map((num) => (
                            <span
                              key={num}
                              className="px-1.5 py-0.5 text-[10px] font-mono rounded bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700"
                            >
                              #{num}
                            </span>
                          ))}
                        </div>
                      </div>
                      <div
                        className={`w-5 h-5 rounded-full border shrink-0 flex items-center justify-center transition-colors ${
                          isSelected
                            ? 'border-accent bg-accent text-white'
                            : 'border-slate-300 dark:border-slate-700 bg-transparent'
                        }`}
                      >
                        {isSelected && <Check className="w-3 h-3 stroke-[3]" />}
                      </div>
                    </button>
                  );
                })}

                {/* Custom Load # Option */}
                <div
                  className={`p-3 rounded-xl border transition-all space-y-2 ${
                    selectedLoadMode === 'custom'
                      ? 'border-accent bg-emerald-500/10 dark:bg-emerald-500/15 ring-1 ring-accent'
                      : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900'
                  }`}
                >
                  <label
                    className="flex items-center justify-between gap-3 cursor-pointer text-sm font-medium text-slate-900 dark:text-slate-100"
                    onClick={() => setSelectedLoadMode('custom')}
                  >
                    <span>Custom Load # / Empty</span>
                    <div
                      className={`w-5 h-5 rounded-full border shrink-0 flex items-center justify-center transition-colors ${
                        selectedLoadMode === 'custom'
                          ? 'border-accent bg-accent text-white'
                          : 'border-slate-300 dark:border-slate-700 bg-transparent'
                      }`}
                    >
                      {selectedLoadMode === 'custom' && <Check className="w-3 h-3 stroke-[3]" />}
                    </div>
                  </label>
                  {selectedLoadMode === 'custom' && (
                    <input
                      type="text"
                      placeholder="Leave empty or enter new Load #"
                      value={customLoad}
                      onChange={(e) => setCustomLoad(e.target.value)}
                      className="w-full text-xs font-mono px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-1 focus:ring-accent"
                    />
                  )}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-3 sm:p-4 border-t border-subtle bg-slate-50/50 dark:bg-slate-900/30 flex items-center justify-end gap-2.5 shrink-0">
          <button
            type="button"
            onClick={onClose}
            disabled={isSubmitting}
            className="px-4 py-2 text-xs font-medium text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={isSubmitting || (conflict.hasAddressConflict && !selectedAddressId)}
            className="px-5 py-2 text-xs font-medium text-white bg-accent hover:bg-accent/90 disabled:opacity-50 disabled:cursor-not-allowed rounded-xl shadow-sm transition-colors cursor-pointer"
          >
            {isSubmitting ? 'Combining...' : 'Confirm & Combine'}
          </button>
        </div>
      </form>
    </ModalOverlay>
  );
};
