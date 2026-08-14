import { useMemo, useState } from 'react';
import Plus from 'lucide-react/dist/esm/icons/plus';

interface SublocationPickerProps {
  /** Letters currently selected. `null` and `[]` both mean nothing selected. */
  value: string[] | null;
  /** Receives the new selection, or `null` once the last letter is cleared. */
  onChange: (next: string[] | null) => void;
}

const DEFAULT_LETTERS = ['A', 'B', 'C', 'D', 'E', 'F'];

/**
 * Sub-location letter chips for a ROW, with an "Other" escape hatch.
 *
 * Rows used to stop at F, so the three screens that pick a sub-location each hardcoded
 * A-F. They no longer do: the DB CHECK has always accepted `^[A-Z]{1,3}$` and rows past F
 * exist in production. A hardcoded list makes those rows unreachable from the UI while
 * still rendering on the map, which reads as data loss rather than a missing option.
 *
 * Letters already present in `value` are always shown even when outside the default set,
 * so opening an item stored at G does not silently drop it on save.
 */
export function SublocationPicker({ value, onChange }: SublocationPickerProps) {
  const [isAdding, setIsAdding] = useState(false);
  const [draft, setDraft] = useState('');

  const letters = useMemo(() => {
    const custom = (value || []).filter((l) => !DEFAULT_LETTERS.includes(l));
    return Array.from(new Set([...DEFAULT_LETTERS, ...custom])).sort();
  }, [value]);

  const toggle = (letter: string) => {
    const current = value || [];
    const next = current.includes(letter)
      ? current.filter((l) => l !== letter)
      : [...current, letter].sort();
    onChange(next.length > 0 ? next : null);
  };

  const commitDraft = () => {
    const letter = draft.toUpperCase();
    if (letter) {
      const current = value || [];
      if (!current.includes(letter)) onChange([...current, letter].sort());
    }
    setDraft('');
    setIsAdding(false);
  };

  const cancelDraft = () => {
    setDraft('');
    setIsAdding(false);
  };

  return (
    <div className="flex flex-wrap gap-1.5 items-center">
      {letters.map((letter) => {
        const isSelected = (value || []).includes(letter);
        return (
          <button
            key={letter}
            type="button"
            onClick={() => toggle(letter)}
            className={`w-9 h-9 rounded-lg text-xs font-black transition-all ${
              isSelected
                ? 'bg-accent text-main shadow-lg shadow-accent/20'
                : 'bg-surface text-muted border border-subtle hover:border-accent/40'
            }`}
          >
            {letter}
          </button>
        );
      })}

      {isAdding ? (
        <div className="flex items-center gap-1">
          <input
            type="text"
            maxLength={1}
            autoFocus
            value={draft}
            onChange={(e) => {
              const val = e.target.value.toUpperCase();
              if (val === '' || /^[A-Z]$/.test(val)) setDraft(val);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                if (draft) commitDraft();
              } else if (e.key === 'Escape') {
                cancelDraft();
              }
            }}
            onBlur={cancelDraft}
            placeholder="G"
            className="w-9 h-9 rounded-lg text-xs font-black text-center bg-surface text-accent border border-accent/60 focus:outline-none"
          />
          <button
            type="button"
            // onBlur on the input fires before click, so commit on mousedown instead.
            onMouseDown={(e) => {
              e.preventDefault();
              commitDraft();
            }}
            className="px-2 h-9 rounded-lg text-[10px] font-black bg-accent text-main uppercase"
          >
            Add
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setIsAdding(true)}
          className="px-2.5 h-9 rounded-lg text-xs font-black transition-all bg-surface text-accent border border-dashed border-accent/40 hover:border-accent/80 flex items-center gap-1"
        >
          <Plus size={12} /> Other
        </button>
      )}
    </div>
  );
}
