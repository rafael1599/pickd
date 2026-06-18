import { createPortal } from 'react-dom';
import X from 'lucide-react/dist/esm/icons/x';
import Pencil from 'lucide-react/dist/esm/icons/pencil';
import type { LabelEntry } from '../hooks/useGenerateLabels';

interface LabelDataModalProps {
  entry: LabelEntry;
  onUpdate: (partial: Partial<LabelEntry>) => void;
  /** Open Item Detail to edit SKU-level data (name, color, UPC) — persists to inventory. */
  onEditSku: () => void;
  onClose: () => void;
}

// Per-label / per-tag fields. These live on the printed tag (each unit/print can
// differ), so they are NOT inventory data — they're edited here, on the label.
const FIELDS: { key: keyof LabelEntry; label: string; placeholder: string }[] = [
  { key: 'extra', label: 'Extra (below SKU)', placeholder: 'e.g. SPECIAL ORDER, DEMO UNIT' },
  { key: 'serialNumber', label: 'Serial No', placeholder: 'Serial number' },
  { key: 'poNumber', label: 'P/O No', placeholder: 'Purchase order number' },
  { key: 'cNumber', label: 'Container No', placeholder: 'Container number' },
  { key: 'madeIn', label: 'Made In', placeholder: 'Country of origin' },
  { key: 'otherNotes', label: 'Notes', placeholder: 'Additional notes' },
];

export function LabelDataModal({ entry, onUpdate, onEditSku, onClose }: LabelDataModalProps) {
  return createPortal(
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-main/70 backdrop-blur-md animate-in fade-in duration-150"
      onClick={onClose}
    >
      <div
        className="bg-surface border border-subtle rounded-2xl w-full max-w-sm shadow-2xl flex flex-col max-h-[85vh] animate-in zoom-in-95 duration-150"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-4 border-b border-subtle">
          <div>
            <p className="text-xs font-black text-content uppercase tracking-tight">Label data</p>
            <p className="text-[10px] text-muted">{entry.sku}</p>
          </div>
          <button onClick={onClose} className="p-1.5 text-muted hover:text-content">
            <X size={18} />
          </button>
        </div>

        <div className="overflow-y-auto p-4 space-y-3">
          {FIELDS.map(({ key, label, placeholder }) => (
            <div key={key}>
              <label className="text-[10px] text-muted font-black uppercase tracking-widest mb-1 block">
                {label}
              </label>
              <input
                type="text"
                value={(entry[key] as string | null) ?? ''}
                onChange={(e) => onUpdate({ [key]: e.target.value.toUpperCase() || null })}
                placeholder={placeholder}
                className="w-full h-10 px-3 bg-card border border-subtle rounded-xl text-xs text-content font-mono placeholder-muted focus:outline-none focus:border-accent/40"
              />
            </div>
          ))}
        </div>

        <div className="p-4 border-t border-subtle">
          {/* Name / color / UPC are SKU-level (inventory) — edited in Item Detail. */}
          <button
            onClick={onEditSku}
            className="w-full h-11 flex items-center justify-center gap-2 rounded-xl text-[10px] font-black uppercase tracking-wider text-accent bg-accent/10 border border-accent/30 active:scale-[0.98] transition-all"
          >
            <Pencil size={13} />
            Edit SKU info (name, color, UPC) in Item Detail
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
