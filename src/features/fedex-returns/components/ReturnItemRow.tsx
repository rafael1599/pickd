import Check from 'lucide-react/dist/esm/icons/check';
import Trash2 from 'lucide-react/dist/esm/icons/trash-2';
import type { FedExReturnItem } from '../types';

interface ReturnItemRowProps {
  item: FedExReturnItem;
  onRemove?: () => void;
  onChangeLocation?: (location: string) => void;
}

const CONDITION_STYLES: Record<FedExReturnItem['condition'], string> = {
  good: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
  damaged: 'bg-yellow-500/15 text-yellow-400 border-yellow-500/30',
  defective: 'bg-red-500/15 text-red-400 border-red-500/30',
  unknown: 'bg-muted/15 text-muted border-muted/30',
};

export const ReturnItemRow: React.FC<ReturnItemRowProps> = ({ item, onRemove }) => {
  return (
    <div className="bg-card border border-subtle rounded-xl p-3 flex items-center gap-3">
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
  );
};
