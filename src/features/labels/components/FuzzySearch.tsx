import { useState, useRef, useCallback } from 'react';
import Search from 'lucide-react/dist/esm/icons/search';
import Package from 'lucide-react/dist/esm/icons/package';
import { useFuzzySearch } from '../hooks/useFuzzySearch';
import type { LabelInventoryItem } from '../hooks/useLabelItems';

interface FuzzySearchProps {
  onSelect: (item: LabelInventoryItem) => void;
  excludeSkus: Set<string>;
  tagCounts: Map<string, number>;
}

export function FuzzySearch({ onSelect, excludeSkus, tagCounts }: FuzzySearchProps) {
  const [query, setQuery] = useState('');
  const [isOpen, setIsOpen] = useState(false);
  const blurTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { search, isReady } = useFuzzySearch(excludeSkus);

  const results = query.length >= 2 ? search(query) : [];

  const handleSelect = useCallback(
    (item: LabelInventoryItem) => {
      onSelect(item);
      setQuery('');
      setIsOpen(false);
    },
    [onSelect]
  );

  const handleFocus = useCallback(() => {
    if (blurTimeout.current) {
      clearTimeout(blurTimeout.current);
      blurTimeout.current = null;
    }
    setIsOpen(true);
  }, []);

  const handleBlur = useCallback(() => {
    blurTimeout.current = setTimeout(() => {
      setIsOpen(false);
    }, 200);
  }, []);

  return (
    <div className="relative">
      {/* Search input */}
      <div className="relative">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={handleFocus}
          onBlur={handleBlur}
          placeholder={isReady ? 'Search SKU or product name...' : 'Loading inventory...'}
          disabled={!isReady}
          className="w-full pl-9 pr-4 py-2.5 rounded-xl bg-surface border border-subtle text-content text-sm placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-accent disabled:opacity-50"
        />
      </div>

      {/* Dropdown */}
      {isOpen && results.length > 0 && (
        <div className="absolute z-50 mt-1.5 w-full max-h-80 overflow-y-auto bg-card border border-subtle rounded-xl shadow-lg">
          {results.map((item) => {
            const tagged = tagCounts.get(item.sku) ?? 0;
            return (
              <button
                key={item.sku}
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => handleSelect(item)}
                className="w-full flex items-center gap-3 px-3 py-2.5 text-left hover:bg-accent/10 transition-colors border-b border-subtle last:border-b-0"
              >
                {/* Thumbnail */}
                {item.image_url ? (
                  <img
                    src={item.image_url}
                    alt={item.sku}
                    className="w-8 h-8 rounded object-cover flex-shrink-0"
                  />
                ) : (
                  <div className="w-8 h-8 rounded bg-surface flex items-center justify-center flex-shrink-0">
                    <Package size={14} className="text-muted" />
                  </div>
                )}

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-sm text-content">{item.sku}</span>
                    {item.location && (
                      <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-700 dark:text-amber-300">
                        {item.location}
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-muted truncate">{item.item_name ?? 'No name'}</p>
                </div>

                {/* Counts */}
                <div className="flex-shrink-0 text-right">
                  <div className="text-[10px] text-muted">qty: {item.quantity}</div>
                  <div className="text-[10px] text-muted">tagged: {tagged}</div>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
