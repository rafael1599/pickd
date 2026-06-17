import { useRef, useState } from 'react';
import Plus from 'lucide-react/dist/esm/icons/plus';
import Minus from 'lucide-react/dist/esm/icons/minus';
import Trash2 from 'lucide-react/dist/esm/icons/trash-2';
import Tag from 'lucide-react/dist/esm/icons/tag';
import type { LabelEntry } from '../hooks/useGenerateLabels';

interface EntryListProps {
  entries: LabelEntry[];
  selectedSku: string | null;
  onSelect: (sku: string) => void;
  onQtyChange: (sku: string, delta: number) => void;
  onQtySet: (sku: string, value: number) => void;
  onRemove: (sku: string) => void;
}

/**
 * Quantity stepper whose number is click-to-edit — tap it to type a value
 * directly (Enter/blur commits, Esc cancels), matching PickD's steppers
 * everywhere else instead of forcing +/- one at a time.
 */
function EntryQty({
  qty,
  onChange,
  onSet,
}: {
  qty: number;
  onChange: (delta: number) => void;
  onSet: (value: number) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(String(qty));
  const inputRef = useRef<HTMLInputElement>(null);

  const startEdit = () => {
    setDraft(String(qty));
    setEditing(true);
    requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });
  };
  const commit = () => {
    const parsed = parseInt(draft, 10);
    if (!isNaN(parsed) && parsed >= 0) onSet(parsed);
    setEditing(false);
  };

  return (
    <>
      <button
        type="button"
        onClick={() => onChange(-1)}
        disabled={qty <= 0}
        className="w-7 h-7 flex items-center justify-center rounded-lg bg-surface border border-subtle text-content transition-all active:scale-95 disabled:opacity-30"
      >
        <Minus size={14} />
      </button>
      {editing ? (
        <input
          ref={inputRef}
          type="number"
          min={0}
          inputMode="numeric"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit();
            if (e.key === 'Escape') setEditing(false);
          }}
          className="w-10 h-7 text-center text-sm font-bold text-content tabular-nums bg-surface border border-accent/40 rounded-lg focus:outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
        />
      ) : (
        <button
          type="button"
          onClick={startEdit}
          title="Tap to type a quantity"
          className="w-10 h-7 text-center text-sm font-bold text-content tabular-nums rounded-lg hover:bg-white/5 active:scale-95 transition-all"
        >
          {qty}
        </button>
      )}
      <button
        type="button"
        onClick={() => onChange(1)}
        className="w-7 h-7 flex items-center justify-center rounded-lg bg-surface border border-subtle text-content transition-all active:scale-95"
      >
        <Plus size={14} />
      </button>
    </>
  );
}

export function EntryList({
  entries,
  selectedSku,
  onSelect,
  onQtyChange,
  onQtySet,
  onRemove,
}: EntryListProps) {
  if (entries.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-muted gap-3">
        <Tag size={32} className="opacity-30" />
        <p className="text-sm font-medium">Search above to add items</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {entries.map((entry) => {
        const isSelected = selectedSku === entry.sku;
        const isComplete = entry.stock > 0 && entry.stock === entry.tagged;

        return (
          <button
            key={entry.sku}
            type="button"
            onClick={() => onSelect(entry.sku)}
            className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl bg-card border text-left transition-all ${
              isSelected ? 'ring-2 ring-accent border-accent' : 'border-subtle'
            }`}
          >
            {/* Left: SKU + name */}
            <div className="flex-1 min-w-0">
              <span className="font-bold text-sm text-content block">{entry.sku}</span>
              <span className="text-xs text-muted truncate block">
                {entry.itemName ?? 'No name'}
              </span>
            </div>

            {/* Middle: location + counts */}
            <div className="flex flex-col items-end gap-0.5 flex-shrink-0">
              {entry.location ? (
                <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-700 dark:text-amber-300">
                  {entry.location}
                </span>
              ) : (
                <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-surface text-muted">
                  No location
                </span>
              )}
              <span className="text-[10px] text-muted">
                stock: {entry.stock} &middot; tagged: {entry.tagged}
              </span>
            </div>

            {/* Right: qty controls or COMPLETE badge */}
            <div
              className="flex items-center gap-1.5 flex-shrink-0"
              onClick={(e) => e.stopPropagation()}
            >
              {isComplete ? (
                <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded-full bg-green-500/20 text-green-700 dark:text-green-400">
                  Complete
                </span>
              ) : (
                <EntryQty
                  qty={entry.qty}
                  onChange={(delta) => onQtyChange(entry.sku, delta)}
                  onSet={(value) => onQtySet(entry.sku, value)}
                />
              )}
              <button
                type="button"
                onClick={() => onRemove(entry.sku)}
                className="w-7 h-7 flex items-center justify-center rounded-lg text-red-500 hover:bg-red-500/10 transition-all active:scale-95 ml-1"
              >
                <Trash2 size={14} />
              </button>
            </div>
          </button>
        );
      })}
    </div>
  );
}
