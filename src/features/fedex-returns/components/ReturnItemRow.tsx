import { useState } from 'react';
import Check from 'lucide-react/dist/esm/icons/check';
import Pencil from 'lucide-react/dist/esm/icons/pencil';
import Trash2 from 'lucide-react/dist/esm/icons/trash-2';
import MapPin from 'lucide-react/dist/esm/icons/map-pin';
import type { FedExReturnItem } from '../types';

interface ReturnItemRowProps {
  item: FedExReturnItem;
  onRemove?: () => void;
  /** Called with the new uppercase-trimmed location. If omitted, location is read-only. */
  onChangeLocation?: (location: string) => void;
}

const CONDITION_STYLES: Record<FedExReturnItem['condition'], string> = {
  good: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
  damaged: 'bg-yellow-500/15 text-yellow-400 border-yellow-500/30',
  defective: 'bg-red-500/15 text-red-400 border-red-500/30',
  unknown: 'bg-muted/15 text-muted border-muted/30',
};

export const ReturnItemRow: React.FC<ReturnItemRowProps> = ({
  item,
  onRemove,
  onChangeLocation,
}) => {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(item.target_location ?? '');
  const [syncedLocation, setSyncedLocation] = useState(item.target_location);

  // Re-sync draft when the item's target_location changes from outside
  // (e.g. realtime), unless the user is mid-edit. Uses the "derived state
  // from a previous value" pattern so we don't setState inside an effect.
  if (!editing && item.target_location !== syncedLocation) {
    setSyncedLocation(item.target_location);
    setDraft(item.target_location ?? '');
  }

  const commit = () => {
    const value = draft.trim().toUpperCase();
    if (!value) {
      // Empty input cancels the edit without persisting.
      setEditing(false);
      setDraft(item.target_location ?? '');
      return;
    }
    if (value !== (item.target_location ?? '')) {
      onChangeLocation?.(value);
    }
    setEditing(false);
  };

  const cancel = () => {
    setEditing(false);
    setDraft(item.target_location ?? '');
  };

  return (
    <div className="bg-card border border-subtle rounded-xl p-3 space-y-2">
      <div className="flex items-center gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-mono font-bold text-content text-sm">{item.sku}</span>
            <span className="text-xs text-muted bg-surface px-2 py-0.5 rounded-full">
              ×{item.quantity}
            </span>
          </div>
          {item.item_name && (
            <div className="text-xs text-muted mt-0.5 truncate">{item.item_name}</div>
          )}
          {item.moved_to_location && (
            <div className="flex items-center gap-1 mt-1 text-[11px] text-emerald-400">
              <Check size={12} />
              <span>Moved to {item.moved_to_location}</span>
            </div>
          )}
        </div>

        <span
          className={`text-[10px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-full border ${CONDITION_STYLES[item.condition]}`}
        >
          {item.condition}
        </span>

        {onRemove && !item.moved_to_location && (
          <button
            onClick={onRemove}
            className="p-1.5 text-muted hover:text-red-400 transition-colors"
            aria-label="Remove item"
          >
            <Trash2 size={14} />
          </button>
        )}
      </div>

      {/* Destination — only shown for pending items (not yet moved). */}
      {!item.moved_to_location && (
        <div className="pt-1 border-t border-subtle/60">
          {editing ? (
            <div className="flex items-center gap-2">
              <input
                type="text"
                autoFocus
                value={draft}
                onChange={(e) => setDraft(e.target.value.toUpperCase())}
                onBlur={commit}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') commit();
                  if (e.key === 'Escape') cancel();
                }}
                placeholder="e.g., ROW 15"
                autoCapitalize="characters"
                autoCorrect="off"
                spellCheck={false}
                className="flex-1 bg-surface border border-subtle rounded-lg px-2.5 py-1.5 text-xs text-content placeholder:text-muted/50 focus:outline-none focus:ring-1 focus:ring-accent"
              />
            </div>
          ) : item.target_location ? (
            <button
              type="button"
              onClick={() => onChangeLocation && setEditing(true)}
              disabled={!onChangeLocation}
              className="w-full flex items-center justify-between gap-2 text-[11px] text-content bg-surface border border-subtle rounded-lg px-2.5 py-1.5 hover:border-accent/40 transition-colors disabled:cursor-default disabled:hover:border-subtle"
            >
              <span className="flex items-center gap-1.5">
                <MapPin size={12} className="text-accent" />
                <span className="font-mono">{item.target_location}</span>
              </span>
              {onChangeLocation && <Pencil size={11} className="text-muted" />}
            </button>
          ) : onChangeLocation ? (
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="w-full flex items-center gap-1.5 text-[11px] text-yellow-400 bg-yellow-500/10 border border-yellow-500/30 rounded-lg px-2.5 py-1.5"
            >
              <MapPin size={12} />
              Set destination location
            </button>
          ) : null}
        </div>
      )}
    </div>
  );
};
