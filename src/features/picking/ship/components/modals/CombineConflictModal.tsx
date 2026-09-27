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
    <ModalOverlay onClose={onClose} maxWidth="md" zIndex={250} className="p-0 overflow-hidden">
      <form onSubmit={handleSubmit} className="flex flex-col">
        {/* Header */}
        <div className="p-5 border-b border-subtle flex items-start gap-3 bg-muted/40">
          <div className="w-10 h-10 rounded-xl bg-amber-500/10 text-amber-500 flex items-center justify-center shrink-0 mt-0.5">
            <AlertTriangle className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-base font-semibold text-main">Resolver conflicto al combinar</h3>
            <p className="text-xs text-muted mt-1 leading-relaxed">
              Los pedidos a combinar tienen datos distintos. Selecciona los valores definitivos para
              el envío compartido:
            </p>
          </div>
        </div>

        {/* Body */}
        <div className="p-5 space-y-6 max-h-[70vh] overflow-y-auto">
          {/* Address Conflict */}
          {conflict.hasAddressConflict && (
            <div className="space-y-3">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-muted uppercase tracking-wider">
                <MapPin className="w-3.5 h-3.5 text-accent" />
                <span>Dirección de destino compartida</span>
              </div>
              <div className="space-y-2">
                {conflict.addressOptions.map((opt) => {
                  const isSelected = selectedAddressId === opt.addressId;
                  return (
                    <button
                      key={opt.addressId}
                      type="button"
                      onClick={() => setSelectedAddressId(opt.addressId)}
                      className={`w-full text-left p-3.5 rounded-xl border transition-all flex items-start justify-between gap-3 cursor-pointer ${
                        isSelected
                          ? 'border-accent bg-accent/5 ring-1 ring-accent'
                          : 'border-subtle bg-card hover:border-default/40'
                      }`}
                    >
                      <div className="space-y-1 min-w-0">
                        <div className="text-sm font-medium text-main truncate">{opt.street}</div>
                        {(opt.city || opt.state || opt.zip) && (
                          <div className="text-xs text-muted">
                            {[opt.city, opt.state, opt.zip].filter(Boolean).join(', ')}
                          </div>
                        )}
                        <div className="flex flex-wrap gap-1 mt-1.5">
                          {opt.orderNumbers.map((num) => (
                            <span
                              key={num}
                              className="px-1.5 py-0.5 text-[10px] font-mono rounded bg-muted/20 text-muted"
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
                            : 'border-subtle bg-transparent'
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
            <div className="space-y-3">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-muted uppercase tracking-wider">
                <Truck className="w-3.5 h-3.5 text-accent" />
                <span>Número de Carga (Load #)</span>
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
                      className={`w-full text-left p-3.5 rounded-xl border transition-all flex items-center justify-between gap-3 cursor-pointer ${
                        isSelected
                          ? 'border-accent bg-accent/5 ring-1 ring-accent'
                          : 'border-subtle bg-card hover:border-default/40'
                      }`}
                    >
                      <div className="space-y-1 min-w-0">
                        <div className="text-sm font-mono font-medium text-main">
                          {opt.loadNumber}
                        </div>
                        <div className="flex flex-wrap gap-1">
                          {opt.orderNumbers.map((num) => (
                            <span
                              key={num}
                              className="px-1.5 py-0.5 text-[10px] font-mono rounded bg-muted/20 text-muted"
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
                            : 'border-subtle bg-transparent'
                        }`}
                      >
                        {isSelected && <Check className="w-3 h-3 stroke-[3]" />}
                      </div>
                    </button>
                  );
                })}

                {/* Custom Load # Option */}
                <div
                  className={`p-3.5 rounded-xl border transition-all space-y-2 ${
                    selectedLoadMode === 'custom'
                      ? 'border-accent bg-accent/5 ring-1 ring-accent'
                      : 'border-subtle bg-card'
                  }`}
                >
                  <label
                    className="flex items-center justify-between gap-3 cursor-pointer text-sm font-medium text-main"
                    onClick={() => setSelectedLoadMode('custom')}
                  >
                    <span>Otro número de carga / Vacío</span>
                    <div
                      className={`w-5 h-5 rounded-full border shrink-0 flex items-center justify-center transition-colors ${
                        selectedLoadMode === 'custom'
                          ? 'border-accent bg-accent text-white'
                          : 'border-subtle bg-transparent'
                      }`}
                    >
                      {selectedLoadMode === 'custom' && <Check className="w-3 h-3 stroke-[3]" />}
                    </div>
                  </label>
                  {selectedLoadMode === 'custom' && (
                    <input
                      type="text"
                      placeholder="Dejar vacío o escribir nuevo Load #"
                      value={customLoad}
                      onChange={(e) => setCustomLoad(e.target.value)}
                      className="w-full text-xs font-mono px-3 py-2 rounded-lg border border-subtle bg-input focus:outline-none focus:ring-1 focus:ring-accent"
                    />
                  )}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-subtle bg-muted/20 flex items-center justify-end gap-2.5">
          <button
            type="button"
            onClick={onClose}
            disabled={isSubmitting}
            className="px-4 py-2 text-xs font-medium text-muted hover:text-main rounded-xl hover:bg-card transition-colors cursor-pointer"
          >
            Cancelar
          </button>
          <button
            type="submit"
            disabled={isSubmitting || (conflict.hasAddressConflict && !selectedAddressId)}
            className="px-5 py-2 text-xs font-medium text-white bg-accent hover:bg-accent/90 disabled:opacity-50 disabled:cursor-not-allowed rounded-xl shadow-sm transition-colors cursor-pointer"
          >
            {isSubmitting ? 'Combinando...' : 'Confirmar y combinar'}
          </button>
        </div>
      </form>
    </ModalOverlay>
  );
};
