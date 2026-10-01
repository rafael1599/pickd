import SlidersHorizontal from 'lucide-react/dist/esm/icons/sliders-horizontal';
import X from 'lucide-react/dist/esm/icons/x';
import { FACET_IDS, chipLabel, type FacetId, type StockFilters } from '../utils/stockFacets';

interface StockFilterBarProps {
  filters: StockFilters;
  activeCount: number;
  onOpen: () => void;
  onRemove: (id: FacetId, value: string) => void;
  onClearAll: () => void;
}

/**
 * The "Filters" pill and, once something is ticked, one chip per selection —
 * tap the × to drop it, the way Amazon and eBay show their applied refinements.
 */
export const StockFilterBar = ({
  filters,
  activeCount,
  onOpen,
  onRemove,
  onClearAll,
}: StockFilterBarProps) => {
  const chips = FACET_IDS.flatMap((id) => filters[id].map((value) => ({ id, value })));
  return (
    <div className="px-4 pt-2 max-w-2xl mx-auto">
      <div className="flex items-center gap-2 overflow-x-auto -mx-1 px-1 pb-1">
        <button
          onClick={onOpen}
          className={`shrink-0 flex items-center gap-1.5 pl-3 pr-3.5 py-1.5 rounded-full border text-xs font-black uppercase tracking-widest transition-all active:scale-95 ${
            activeCount > 0
              ? 'bg-accent border-accent text-white shadow-lg shadow-accent/20'
              : 'bg-surface border-subtle text-content hover:border-neutral-500'
          }`}
        >
          <SlidersHorizontal size={14} />
          Filters
          {activeCount > 0 && (
            <span className="ml-0.5 min-w-[18px] h-[18px] px-1 rounded-full bg-white text-accent text-[10px] leading-[18px] text-center tabular-nums">
              {activeCount}
            </span>
          )}
        </button>
        {chips.map(({ id, value }) => (
          <button
            key={`${id}:${value}`}
            onClick={() => onRemove(id, value)}
            className="shrink-0 flex items-center gap-1 pl-3 pr-2 py-1.5 rounded-full bg-accent/15 border border-accent/40 text-xs font-bold text-content whitespace-nowrap active:scale-95 transition-all"
            aria-label={`Remove filter ${chipLabel(id, value)}`}
          >
            {chipLabel(id, value)}
            <X size={13} className="text-muted" />
          </button>
        ))}
        {chips.length > 1 && (
          <button
            onClick={onClearAll}
            className="shrink-0 px-2 py-1.5 text-xs font-black uppercase tracking-widest text-accent whitespace-nowrap"
          >
            Clear all
          </button>
        )}
      </div>
    </div>
  );
};
