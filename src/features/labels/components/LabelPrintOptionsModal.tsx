import { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Printer from 'lucide-react/dist/esm/icons/printer';
import Check from 'lucide-react/dist/esm/icons/check';
import Minus from 'lucide-react/dist/esm/icons/minus';
import Plus from 'lucide-react/dist/esm/icons/plus';

import {
  getLabelLayoutPreference,
  useLabelLayoutPreference,
  type LabelLayout,
} from '../hooks/useLabelLayoutPreference';
import { getLabelCodeOptions, useLabelCodeOptions } from '../hooks/useLabelPrintOptions';

export interface LabelPrintResult {
  orientation: LabelLayout;
  withQr: boolean;
  withBarcode: boolean;
  quantity: number;
}

interface LabelPrintOptionsModalProps {
  /** Called with the chosen options. The opener runs the async print + closes. */
  onConfirm: (result: LabelPrintResult) => void;
  onClose: () => void;
  /** Disable controls while the opener is generating the PDF. */
  isBusy?: boolean;
  title?: string;
  confirmLabel?: string;
  /** Orientation picker — hide it where orientation is per-item (Label Studio). */
  showOrientation?: boolean;
  /** Quantity stepper — shown when printing fresh labels (Item Detail). */
  showQuantity?: boolean;
  initialQuantity?: number;
  /** Upper bound for the "All" shortcut (e.g. units on hand). */
  allQuantity?: number;
  /** Optional secondary action, e.g. "Edit in Studio". */
  secondaryAction?: { label: string; onClick: () => void };
}

const CHECKBOXES: { key: 'withQr' | 'withBarcode'; label: string; hint: string }[] = [
  { key: 'withQr', label: 'QR code', hint: 'Opens the SKU page when scanned' },
  { key: 'withBarcode', label: 'Barcode', hint: 'Code 128 of the SKU' },
];

export const LabelPrintOptionsModal = ({
  onConfirm,
  onClose,
  isBusy = false,
  title = 'Print labels',
  confirmLabel,
  showOrientation = false,
  showQuantity = false,
  initialQuantity = 1,
  allQuantity,
  secondaryAction,
}: LabelPrintOptionsModalProps) => {
  // Seed from the persisted preferences so the window opens on the last choice.
  const [, persistLayout] = useLabelLayoutPreference();
  const [, persistCodes] = useLabelCodeOptions();

  const [orientation, setOrientation] = useState<LabelLayout>(getLabelLayoutPreference);
  const [codes, setCodes] = useState(getLabelCodeOptions);
  const [quantity, setQuantity] = useState(Math.max(1, initialQuantity));

  const [qtyEditing, setQtyEditing] = useState(false);
  const [qtyDraft, setQtyDraft] = useState(String(Math.max(1, initialQuantity)));
  const qtyInputRef = useRef<HTMLInputElement>(null);

  const startQtyEdit = () => {
    setQtyDraft(String(quantity));
    setQtyEditing(true);
    requestAnimationFrame(() => {
      qtyInputRef.current?.focus();
      qtyInputRef.current?.select();
    });
  };
  const commitQty = () => {
    const parsed = parseInt(qtyDraft, 10);
    setQuantity(!isNaN(parsed) && parsed >= 1 ? parsed : quantity);
    setQtyEditing(false);
  };

  const handleConfirm = () => {
    if (showOrientation) persistLayout(orientation);
    persistCodes(codes);
    // If the qty input is still focused (Print clicked without pressing Enter),
    // its blur-commit races this handler — read the draft so the typed value wins.
    let qty = quantity;
    if (showQuantity && qtyEditing) {
      const parsed = parseInt(qtyDraft, 10);
      if (!isNaN(parsed) && parsed >= 1) qty = parsed;
    }
    onConfirm({
      orientation,
      withQr: codes.withQr,
      withBarcode: codes.withBarcode,
      quantity: showQuantity ? qty : 1,
    });
  };

  return createPortal(
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-main/70 backdrop-blur-md animate-in fade-in duration-150"
      onClick={onClose}
    >
      <div
        className="bg-surface border border-subtle rounded-2xl w-full max-w-xs shadow-2xl p-5 space-y-4 animate-in zoom-in-95 duration-150"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2">
          <Printer size={16} className="text-accent" />
          <p className="text-xs font-black text-content uppercase tracking-tight">{title}</p>
        </div>

        {/* Orientation */}
        {showOrientation && (
          <div className="space-y-1.5">
            <p className="text-[10px] font-black text-muted uppercase tracking-widest">
              Orientation
            </p>
            <div className="flex gap-2">
              {(
                [
                  ['standard', 'Horizontal'],
                  ['vertical', 'Vertical'],
                ] as [LabelLayout, string][]
              ).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setOrientation(value)}
                  aria-pressed={orientation === value}
                  className={`flex-1 h-9 rounded-xl text-[10px] font-black uppercase tracking-wider transition-all active:scale-[0.98] ${
                    orientation === value
                      ? 'bg-accent text-main'
                      : 'bg-card border border-subtle text-muted'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Quantity */}
        {showQuantity && (
          <div className="space-y-1.5">
            <p className="text-[10px] font-black text-muted uppercase tracking-widest">Quantity</p>
            <div className="flex items-center justify-center gap-2">
              <button
                type="button"
                onClick={() => setQuantity((q) => Math.max(1, q - 1))}
                className="w-9 h-9 rounded-xl bg-card border border-subtle flex items-center justify-center text-content active:scale-90 transition-all"
              >
                <Minus size={16} />
              </button>
              {qtyEditing ? (
                <input
                  ref={qtyInputRef}
                  type="number"
                  min={1}
                  inputMode="numeric"
                  value={qtyDraft}
                  onChange={(e) => setQtyDraft(e.target.value)}
                  onBlur={commitQty}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') commitQty();
                    if (e.key === 'Escape') setQtyEditing(false);
                  }}
                  className="w-16 h-9 text-center text-base font-black text-content tabular-nums bg-card border border-accent/40 rounded-xl focus:outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                />
              ) : (
                <button
                  type="button"
                  onClick={startQtyEdit}
                  className="w-16 h-9 text-center text-base font-black text-content tabular-nums bg-card border border-subtle rounded-xl active:scale-95 transition-all"
                >
                  {quantity}
                </button>
              )}
              <button
                type="button"
                onClick={() => setQuantity((q) => q + 1)}
                className="w-9 h-9 rounded-xl bg-card border border-subtle flex items-center justify-center text-content active:scale-90 transition-all"
              >
                <Plus size={16} />
              </button>
              {allQuantity != null && allQuantity > 0 && (
                <button
                  type="button"
                  onClick={() => setQuantity(allQuantity)}
                  className="text-[9px] font-bold text-accent px-2 py-1 bg-accent/10 border border-accent/20 rounded-lg active:scale-95"
                >
                  All {allQuantity}
                </button>
              )}
            </div>
          </div>
        )}

        {/* Codes (deselect parts) */}
        <div className="space-y-1.5">
          <p className="text-[10px] font-black text-muted uppercase tracking-widest">Include</p>
          <div className="space-y-1.5">
            {CHECKBOXES.map(({ key, label, hint }) => {
              const checked = codes[key];
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => setCodes((c) => ({ ...c, [key]: !c[key] }))}
                  aria-pressed={checked}
                  className="w-full flex items-center gap-3 px-3 py-2 rounded-xl bg-card border border-subtle text-left active:scale-[0.99] transition-all"
                >
                  <span
                    className={`w-5 h-5 rounded-md flex items-center justify-center shrink-0 transition-colors ${
                      checked
                        ? 'bg-accent text-main'
                        : 'bg-surface border border-subtle text-transparent'
                    }`}
                  >
                    <Check size={13} strokeWidth={3.5} />
                  </span>
                  <span className="flex-1 min-w-0">
                    <span className="block text-xs font-bold text-content">{label}</span>
                    <span className="block text-[10px] text-muted truncate">{hint}</span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Actions */}
        <div className="space-y-2 pt-1">
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={isBusy}
              className="flex-1 h-10 rounded-xl text-[10px] font-black uppercase tracking-wider text-muted bg-card border border-subtle active:scale-[0.98] transition-all disabled:opacity-40"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleConfirm}
              disabled={isBusy}
              className="flex-1 h-10 rounded-xl text-[10px] font-black uppercase tracking-wider text-main bg-accent active:scale-[0.98] transition-all disabled:opacity-40 flex items-center justify-center gap-1.5"
            >
              {isBusy ? (
                'Printing…'
              ) : (
                <>
                  <Printer size={14} />
                  {confirmLabel ?? 'Print'}
                </>
              )}
            </button>
          </div>
          {secondaryAction && (
            <button
              type="button"
              onClick={secondaryAction.onClick}
              disabled={isBusy}
              className="w-full h-9 rounded-xl text-[10px] font-black uppercase tracking-wider text-accent bg-accent/10 border border-accent/30 active:scale-[0.98] transition-all disabled:opacity-40"
            >
              {secondaryAction.label}
            </button>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
};
