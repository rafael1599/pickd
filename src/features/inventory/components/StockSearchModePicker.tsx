import { useEffect, useRef, useState } from 'react';
import ChevronDown from 'lucide-react/dist/esm/icons/chevron-down';
import Check from 'lucide-react/dist/esm/icons/check';
import {
  STOCK_SEARCH_FIELD_TAG,
  STOCK_SEARCH_MODES,
  type StockSearchField,
  type StockSearchMode,
} from '../utils/stockSearch';

interface StockSearchModePickerProps {
  mode: StockSearchMode;
  /** The field the current term resolves to — what `auto` decided. */
  field: StockSearchField;
  onChange: (mode: StockSearchMode) => void;
}

/**
 * The chip inside the Stock search bar: says what the term is being looked up
 * as (SKU / ANY / NAME…) and opens the list to pin one. A dropdown, not a
 * modal: it lives and dies with the bar (docs/modal-pattern.md, exceptions).
 */
export const StockSearchModePicker = ({ mode, field, onChange }: StockSearchModePickerProps) => {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [open]);

  const isAuto = mode === 'auto';

  return (
    <div ref={rootRef} className="relative shrink-0 ml-2">
      <button
        type="button"
        // Keep the keyboard up: the input must not lose focus.
        onMouseDown={(e) => e.preventDefault()}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`Search by ${isAuto ? 'auto' : mode}`}
        className={`flex items-center gap-1 h-8 pl-2 pr-1.5 rounded-lg border text-[10px] font-black uppercase tracking-widest active:scale-95 transition-all ${
          isAuto
            ? 'border-subtle text-muted bg-main/40'
            : 'border-accent/40 text-accent bg-accent/10'
        }`}
      >
        {isAuto && <span className="text-accent/70">A·</span>}
        <span>{STOCK_SEARCH_FIELD_TAG[field]}</span>
        <ChevronDown size={12} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <ul
          role="listbox"
          className="absolute left-0 top-full mt-2 z-50 w-64 max-w-[calc(100vw-2rem)] bg-surface border border-subtle rounded-2xl shadow-xl p-1 animate-in fade-in zoom-in-95 duration-150"
        >
          {STOCK_SEARCH_MODES.map((opt) => {
            const selected = opt.mode === mode;
            return (
              <li key={opt.mode} role="option" aria-selected={selected}>
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={(e) => {
                    e.stopPropagation();
                    onChange(opt.mode);
                    setOpen(false);
                  }}
                  className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left active:scale-[0.98] transition-all ${
                    selected ? 'bg-accent/10' : 'hover:bg-white/5'
                  }`}
                >
                  <div className="flex-1 min-w-0">
                    <div
                      className={`text-sm font-black ${selected ? 'text-accent' : 'text-content'}`}
                    >
                      {opt.label}
                    </div>
                    <div className="text-[11px] text-muted truncate">{opt.hint}</div>
                  </div>
                  {selected && <Check size={16} className="text-accent shrink-0" />}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
};
