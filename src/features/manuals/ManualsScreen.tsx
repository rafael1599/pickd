import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import ArrowLeft from 'lucide-react/dist/esm/icons/arrow-left';
import BookOpen from 'lucide-react/dist/esm/icons/book-open';
import ChevronRight from 'lucide-react/dist/esm/icons/chevron-right';
import ListOrdered from 'lucide-react/dist/esm/icons/list-ordered';
import { SearchInput } from '../../components/ui/SearchInput.tsx';
import { useDebounce } from '../../hooks/useDebounce.ts';
import { manualSearchText } from '../../content/manuals/types.ts';
import { MANUALS, manualsByCategory, type Manual } from '../../content/manuals/index.ts';

const ManualRow: React.FC<{ manual: Manual; onOpen: () => void }> = ({ manual, onOpen }) => (
  <div
    role="button"
    tabIndex={0}
    onClick={onOpen}
    onKeyDown={(e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        onOpen();
      }
    }}
    className="w-full bg-card border border-subtle rounded-2xl p-3 flex items-center gap-3 text-left cursor-pointer hover:border-accent/40 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
  >
    <div className="p-2 bg-surface border border-subtle rounded-xl text-sky-500 shrink-0">
      <BookOpen size={16} />
    </div>
    <div className="min-w-0 flex-1">
      <p className="text-sm font-bold text-content truncate">{manual.title}</p>
      <p className="text-xs text-muted line-clamp-2">{manual.summary}</p>
      {manual.content.steps.length > 0 && (
        <p className="flex items-center gap-1 text-[10px] text-muted/70 uppercase font-bold tracking-tight mt-1">
          <ListOrdered size={10} />
          {manual.content.steps.length} steps
        </p>
      )}
    </div>
    <ChevronRight size={16} className="text-muted shrink-0" />
  </div>
);

export const ManualsScreen: React.FC = () => {
  const navigate = useNavigate();

  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<string | null>(null);
  const debouncedQuery = useDebounce(query, 200);

  const categories = useMemo(
    () => [...new Set(MANUALS.map((m) => m.category))].sort((a, b) => a.localeCompare(b)),
    []
  );

  // Built once: the library ships with the bundle, so there is nothing to
  // recompute between renders and nothing to wait for on first paint.
  const haystacks = useMemo(
    () =>
      new Map(
        MANUALS.map((m) => [
          m.slug,
          [m.title, m.category, m.summary, manualSearchText(m.content)].join(' ').toLowerCase(),
        ])
      ),
    []
  );

  const filtered = useMemo(() => {
    const q = debouncedQuery.trim().toLowerCase();
    return MANUALS.filter((m) => {
      if (category && m.category !== category) return false;
      if (!q) return true;
      // The body is searched too: people look for a procedure by a value they
      // half-remember ("3481", "chemtrec"), not by its title.
      return (haystacks.get(m.slug) ?? '').includes(q);
    });
  }, [debouncedQuery, category, haystacks]);

  const grouped = useMemo(() => manualsByCategory(filtered), [filtered]);

  return (
    <div className="p-4 max-w-2xl mx-auto pb-32">
      <div className="flex items-center gap-3 mb-4">
        <button
          onClick={() => navigate('/')}
          className="p-2 hover:bg-card rounded-xl text-muted hover:text-content transition-colors"
          aria-label="Back"
        >
          <ArrowLeft size={20} />
        </button>
        <div className="flex-1">
          <h1 className="text-lg font-black text-content uppercase tracking-tight">Manuals</h1>
          <p className="text-[10px] text-muted font-bold uppercase tracking-widest">
            Warehouse procedures
          </p>
        </div>
      </div>

      <div className="mb-3">
        <SearchInput
          value={query}
          onChange={setQuery}
          placeholder="Search a manual, a field, or a value…"
          variant="inline"
          preferenceId="manuals"
        />
      </div>

      {categories.length > 1 && (
        <div className="flex items-center gap-2 overflow-x-auto pb-1 mb-4 -mx-1 px-1">
          <button
            onClick={() => setCategory(null)}
            className={`shrink-0 px-3 py-1.5 rounded-xl text-[10px] font-black uppercase tracking-tight border transition-colors ${
              category === null
                ? 'bg-accent text-white border-accent'
                : 'bg-card text-muted border-subtle hover:text-content'
            }`}
          >
            All
          </button>
          {categories.map((cat) => (
            <button
              key={cat}
              onClick={() => setCategory(cat === category ? null : cat)}
              className={`shrink-0 px-3 py-1.5 rounded-xl text-[10px] font-black uppercase tracking-tight border transition-colors ${
                category === cat
                  ? 'bg-accent text-white border-accent'
                  : 'bg-card text-muted border-subtle hover:text-content'
              }`}
            >
              {cat}
            </button>
          ))}
        </div>
      )}

      {filtered.length === 0 ? (
        <div className="text-center py-12 px-4">
          <BookOpen size={28} className="mx-auto text-muted/30 mb-3" />
          <p className="text-sm text-muted">
            {debouncedQuery.trim()
              ? `Nothing matches "${debouncedQuery.trim()}".`
              : `Nothing filed under ${category} yet.`}
          </p>
        </div>
      ) : (
        <div className="space-y-5">
          {grouped.map(([cat, items]) => (
            <div key={cat}>
              <p className="text-[10px] text-muted font-black uppercase tracking-widest mb-2">
                {cat} · {items.length}
              </p>
              <div className="space-y-2">
                {items.map((manual) => (
                  <ManualRow
                    key={manual.slug}
                    manual={manual}
                    onOpen={() => navigate(`/manuals/${manual.slug}`)}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
