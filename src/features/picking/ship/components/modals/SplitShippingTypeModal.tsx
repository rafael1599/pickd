import React, { useState } from 'react';
import { Truck, Package, AlertCircle } from 'lucide-react';
import { ModalOverlay } from '../../../../../components/ui/ModalOverlay';

export interface SplitShippingTypeOrder {
  id: string;
  orderNumber?: string | null;
  bikeCount: number;
}

export interface SplitShippingTypeModalProps {
  orders: SplitShippingTypeOrder[];
  onConfirm: (selections: Record<string, 'regular' | 'fedex'>) => Promise<void> | void;
  onClose: () => void;
}

export const SplitShippingTypeModal: React.FC<SplitShippingTypeModalProps> = ({
  orders,
  onConfirm,
  onClose,
}) => {
  const [selections, setSelections] = useState<Record<string, 'regular' | 'fedex'>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Check if every order has a selection
  const allSelected = orders.length > 0 && orders.every((o) => !!selections[o.id]);

  const handleSelect = (orderId: string, type: 'regular' | 'fedex') => {
    setSelections((prev) => ({ ...prev, [orderId]: type }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!allSelected || isSubmitting) return;

    setIsSubmitting(true);
    try {
      await onConfirm(selections);
      onClose();
    } catch (err) {
      console.error('[SplitShippingTypeModal] Confirm error:', err);
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
            <AlertCircle className="w-4 h-4" />
          </div>
          <div className="min-w-0">
            <h3 className="text-sm sm:text-base font-semibold text-slate-900 dark:text-slate-100">
              Shipping Method Required
            </h3>
            <p className="text-xs text-slate-600 dark:text-slate-400 mt-0.5 leading-relaxed">
              These orders have under 5 bikes and would default to FedEx. Choose how each order
              should ship:
            </p>
          </div>
        </div>

        {/* Body */}
        <div className="p-3.5 sm:p-4 space-y-3 overflow-y-auto flex-1 min-h-0">
          {orders.map((ord) => {
            const current = selections[ord.id];
            const orderLabel = ord.orderNumber || ord.id.slice(-6).toUpperCase();
            return (
              <div
                key={ord.id}
                className="p-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/60 space-y-2.5"
              >
                <div className="flex items-center justify-between">
                  <span className="text-sm font-bold text-slate-900 dark:text-slate-100">
                    Order #{orderLabel}
                  </span>
                  <span className="text-xs text-slate-500 dark:text-slate-400 font-medium">
                    {ord.bikeCount} {ord.bikeCount === 1 ? 'bike' : 'bikes'}
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => handleSelect(ord.id, 'regular')}
                    className={`py-2 px-3 rounded-lg border text-xs font-semibold flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
                      current === 'regular'
                        ? 'border-emerald-500 bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 ring-1 ring-emerald-500'
                        : 'border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50 text-slate-700 dark:text-slate-300 hover:border-slate-300 dark:hover:border-slate-600'
                    }`}
                  >
                    <Truck className="w-3.5 h-3.5 shrink-0" />
                    <span>Regular</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => handleSelect(ord.id, 'fedex')}
                    className={`py-2 px-3 rounded-lg border text-xs font-semibold flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
                      current === 'fedex'
                        ? 'border-purple-500 bg-purple-500/15 text-purple-600 dark:text-purple-400 ring-1 ring-purple-500'
                        : 'border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50 text-slate-700 dark:text-slate-300 hover:border-slate-300 dark:hover:border-slate-600'
                    }`}
                  >
                    <Package className="w-3.5 h-3.5 shrink-0" />
                    <span>FedEx</span>
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        {/* Footer */}
        <div className="p-3.5 sm:p-4 border-t border-subtle flex items-center justify-end gap-2 bg-slate-50 dark:bg-slate-900/50 shrink-0">
          <button
            type="button"
            onClick={onClose}
            disabled={isSubmitting}
            className="px-3.5 py-1.5 rounded-lg text-xs font-medium text-slate-600 dark:text-slate-400 hover:bg-slate-200/50 dark:hover:bg-slate-800 transition-colors"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={!allSelected || isSubmitting}
            className={`px-4 py-1.5 rounded-lg text-xs font-semibold text-white shadow-sm transition-all ${
              allSelected && !isSubmitting
                ? 'bg-amber-600 hover:bg-amber-500 active:scale-[0.98]'
                : 'bg-slate-400 dark:bg-slate-700 opacity-50 cursor-not-allowed'
            }`}
          >
            {isSubmitting ? 'Separating…' : 'Confirm & Separate'}
          </button>
        </div>
      </form>
    </ModalOverlay>
  );
};
