import { useMemo, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import X from 'lucide-react/dist/esm/icons/x';
import ChevronDown from 'lucide-react/dist/esm/icons/chevron-down';
import ChevronRight from 'lucide-react/dist/esm/icons/chevron-right';
import Check from 'lucide-react/dist/esm/icons/check';
import Loader2 from 'lucide-react/dist/esm/icons/loader-2';
import Search from 'lucide-react/dist/esm/icons/search';
import { useScrollLock } from '../../../hooks/useScrollLock';
import type { InventoryItemWithMetadata } from '../../../schemas/inventory.schema';
import { useBikeCatalog, useStockFilters } from '../hooks/useStockFilters';
import {
  AREA,
  AREA_LABEL,
  AREA_ORDER,
  COND_LABEL,
  COND_ORDER,
  LINE,
  LOC,
  MODEL,
  PHOTO_LABEL,
  STOCK_LABEL,
  STOCK_ORDER,
  TYPE_LABEL,
  TYPE_ORDER,
  applyStockFilters,
  colorSwatch,
  compareSizes,
  facetCounts,
  locationArea,
  modelLine,
  scopeStockSource,
  sizeGroup,
  titleCase,
  withFacets,
  type FacetId,
  type OptionCount,
} from '../utils/stockFacets';

interface StockFilterSheetProps {
  onClose: () => void;
  showInactive: boolean;
  onlyScratchDent: boolean;
  onlyPhoto?: boolean;
  /** While a text search is open, the facets count its results instead of the catalogue. */
  searchItems?: InventoryItemWithMetadata[] | null;
}

const COLLAPSED_LIMIT = 8;

/**
 * The Amazon/eBay filter panel for Stock: a bottom sheet on a phone, a drawer
 * on the right on a desktop. Every tap writes the URL at once and the list
 * behind updates live; the button at the foot says how many bikes you'll see.
 */
export const StockFilterSheet = ({
  onClose,
  showInactive,
  onlyScratchDent,
  onlyPhoto = false,
  searchItems,
}: StockFilterSheetProps) => {
  useScrollLock(true, onClose);
  const { filters, activeCount, toggle, clearFacet, clearAll } = useStockFilters();
  const catalog = useBikeCatalog(showInactive, !searchItems);

  const rows = useMemo(
    () =>
      withFacets(
        searchItems ??
          scopeStockSource(catalog.data ?? [], { showInactive, onlyScratchDent, onlyPhoto })
      ),
    [searchItems, catalog.data, showInactive, onlyScratchDent, onlyPhoto]
  );
  const counts = useMemo(() => facetCounts(rows, filters), [rows, filters]);
  const result = useMemo(() => {
    const items = applyStockFilters(rows, filters);
    return {
      units: items.reduce((s, i) => s + (i.quantity ?? 0), 0),
      skus: new Set(items.map((i) => i.sku)).size,
    };
  }, [rows, filters]);

  const loading = !searchItems && catalog.isLoading;

  return createPortal(
    <div
      className="fixed inset-0 z-[110] flex items-end md:items-stretch md:justify-end bg-main/60 backdrop-blur-sm animate-in fade-in duration-200"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-label="Filters"
        className="w-full md:w-[420px] max-h-[90vh] md:max-h-none md:h-full flex flex-col bg-surface border-t md:border-t-0 md:border-l border-subtle rounded-t-3xl md:rounded-none shadow-2xl animate-in slide-in-from-bottom md:slide-in-from-right duration-300"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 px-5 pt-4 pb-3 border-b border-subtle shrink-0">
          <div className="md:hidden absolute left-1/2 -translate-x-1/2 top-1.5 h-1 w-10 rounded-full bg-subtle" />
          <h2
            className="text-xl font-black uppercase tracking-tighter text-content flex-1"
            style={{ fontFamily: 'var(--font-heading)' }}
          >
            Filters
            {activeCount > 0 && (
              <span className="ml-2 text-accent tabular-nums">{activeCount}</span>
            )}
          </h2>
          {activeCount > 0 && (
            <button
              onClick={clearAll}
              className="text-xs font-black uppercase tracking-widest text-accent px-2 py-1 rounded-lg hover:bg-card"
            >
              Clear all
            </button>
          )}
          <button
            onClick={onClose}
            aria-label="Close filters"
            className="p-2 -mr-2 rounded-full text-muted hover:bg-card transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto overscroll-contain">
          {loading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="animate-spin text-accent w-6 h-6 opacity-40" />
            </div>
          ) : (
            <>
              <TreeFacet
                title="Model"
                facet="model"
                parentPrefix={LINE}
                childPrefix={MODEL}
                counts={counts.model}
                selected={filters.model}
                onToggle={toggle}
                onClear={clearFacet}
                parentLabel={(line) => (line ? titleCase(line) : 'No model')}
                childOf={(model, line) => modelBelongsTo(model, line)}
                order="units"
                searchable
                defaultOpen
              />
              <SizeFacet
                counts={counts.size}
                selected={filters.size}
                onToggle={toggle}
                onClear={clearFacet}
              />
              <ColorFacet
                counts={counts.color}
                selected={filters.color}
                onToggle={toggle}
                onClear={clearFacet}
              />
              <ChipFacet
                title="Model year"
                facet="year"
                options={[...counts.year.keys()].sort((a, b) => (b || '0').localeCompare(a || '0'))}
                label={(v) => v || 'No year'}
                counts={counts.year}
                selected={filters.year}
                onToggle={toggle}
                onClear={clearFacet}
              />
              <TreeFacet
                title="Location"
                facet="area"
                parentPrefix={AREA}
                childPrefix={LOC}
                counts={counts.area}
                selected={filters.area}
                onToggle={toggle}
                onClear={clearFacet}
                parentLabel={(a) => AREA_LABEL[a as keyof typeof AREA_LABEL] ?? a}
                childOf={(loc, area) => locationArea(loc) === area}
                order={AREA_ORDER}
              />
              <ChipFacet
                title="Type"
                facet="type"
                options={TYPE_ORDER}
                label={(v) => TYPE_LABEL[v as keyof typeof TYPE_LABEL]}
                counts={counts.type}
                selected={filters.type}
                onToggle={toggle}
                onClear={clearFacet}
              />
              {!onlyScratchDent && !onlyPhoto && (
                <ChipFacet
                  title="Condition"
                  facet="cond"
                  options={COND_ORDER}
                  label={(v) => COND_LABEL[v as keyof typeof COND_LABEL]}
                  counts={counts.cond}
                  selected={filters.cond}
                  onToggle={toggle}
                  onClear={clearFacet}
                />
              )}
              <ChipFacet
                title="Units in the spot"
                facet="stock"
                options={STOCK_ORDER}
                label={(v) => STOCK_LABEL[v as keyof typeof STOCK_LABEL]}
                counts={counts.stock}
                selected={filters.stock}
                onToggle={toggle}
                onClear={clearFacet}
              />
              <ChipFacet
                title="Photo"
                facet="photo"
                options={['with', 'without']}
                label={(v) => PHOTO_LABEL[v as keyof typeof PHOTO_LABEL]}
                counts={counts.photo}
                selected={filters.photo}
                onToggle={toggle}
                onClear={clearFacet}
              />
              <div className="h-4" />
            </>
          )}
        </div>

        <div className="shrink-0 border-t border-subtle px-4 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))] bg-surface">
          <button
            onClick={onClose}
            disabled={loading}
            className="w-full py-3.5 rounded-2xl bg-accent text-white font-black uppercase tracking-widest text-sm shadow-lg shadow-accent/20 active:scale-[0.98] transition-all disabled:opacity-50"
          >
            {result.units === 0 && activeCount > 0
              ? 'No bikes match'
              : `Show ${result.units.toLocaleString()} bikes`}
            <span className="ml-2 font-bold opacity-70 normal-case tracking-normal">
              · {result.skus.toLocaleString()} SKUs
            </span>
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
};

// ── Sections ─────────────────────────────────────────────────────────────

interface FacetCommon {
  counts: Map<string, OptionCount>;
  selected: string[];
  onToggle: (id: FacetId, value: string) => void;
  onClear: (id: FacetId) => void;
}

function Section({
  title,
  selectedCount,
  onClear,
  defaultOpen = true,
  children,
}: {
  title: string;
  selectedCount: number;
  onClear: () => void;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen || selectedCount > 0);
  return (
    <section className="border-b border-subtle">
      <div className="flex items-center gap-2 px-5 py-3">
        <button
          onClick={() => setOpen((o) => !o)}
          className="flex-1 flex items-center gap-2 text-left"
          aria-expanded={open}
        >
          <span className="text-xs font-black uppercase tracking-widest text-content">{title}</span>
          {selectedCount > 0 && (
            <span className="text-[10px] font-black tabular-nums px-1.5 py-0.5 rounded-md bg-accent text-white">
              {selectedCount}
            </span>
          )}
          <ChevronDown
            size={16}
            className={`ml-auto text-muted transition-transform ${open ? 'rotate-180' : ''}`}
          />
        </button>
        {selectedCount > 0 && (
          <button
            onClick={onClear}
            className="text-[10px] font-black uppercase tracking-widest text-muted hover:text-accent"
          >
            Clear
          </button>
        )}
      </div>
      {open && <div className="px-4 pb-4">{children}</div>}
    </section>
  );
}

function Count({ c }: { c?: OptionCount }) {
  return (
    <span className="ml-auto pl-2 text-xs font-bold tabular-nums text-muted">
      {(c?.units ?? 0).toLocaleString()}
    </span>
  );
}

function CheckRow({
  checked,
  onClick,
  children,
  count,
  indent = false,
  trailing,
}: {
  checked: boolean;
  onClick: () => void;
  children: ReactNode;
  count?: OptionCount;
  indent?: boolean;
  trailing?: ReactNode;
}) {
  return (
    <div className={`flex items-center ${indent ? 'pl-7' : ''}`}>
      <button
        onClick={onClick}
        aria-pressed={checked}
        className={`flex-1 min-w-0 flex items-center gap-3 px-2 py-2 rounded-xl text-left transition-colors hover:bg-card ${
          count?.rows ? '' : 'opacity-40'
        }`}
      >
        <span
          className={`shrink-0 w-5 h-5 rounded-md border-2 flex items-center justify-center transition-colors ${
            checked ? 'bg-accent border-accent' : 'border-neutral-600'
          }`}
        >
          {checked && <Check size={14} className="text-white" strokeWidth={3} />}
        </span>
        <span
          className={`min-w-0 truncate text-sm ${checked ? 'font-black text-content' : 'font-semibold text-content'}`}
        >
          {children}
        </span>
        <Count c={count} />
      </button>
      {trailing}
    </div>
  );
}

function Chip({
  checked,
  onClick,
  children,
  count,
}: {
  checked: boolean;
  onClick: () => void;
  children: ReactNode;
  count?: OptionCount;
}) {
  return (
    <button
      onClick={onClick}
      aria-pressed={checked}
      className={`flex flex-col items-center justify-center min-w-[64px] px-3 py-2 rounded-xl border-2 transition-all active:scale-95 ${
        checked
          ? 'border-accent bg-accent/15 text-content'
          : 'border-subtle bg-card text-content hover:border-neutral-500'
      } ${count?.rows ? '' : 'opacity-40'}`}
    >
      <span className="text-sm font-black leading-tight whitespace-nowrap">{children}</span>
      <span className="text-[10px] font-bold tabular-nums text-muted leading-tight">
        {(count?.units ?? 0).toLocaleString()}
      </span>
    </button>
  );
}

/** Options with nothing behind them are hidden — unless ticked, so they can be unticked. */
const visible = (counts: Map<string, OptionCount>, selected: string[], key: string) =>
  (counts.get(key)?.rows ?? 0) > 0 || selected.includes(key);

function ChipFacet({
  title,
  facet,
  options,
  label,
  counts,
  selected,
  onToggle,
  onClear,
}: FacetCommon & {
  title: string;
  facet: FacetId;
  options: readonly string[];
  label: (v: string) => string;
}) {
  const shown = options.filter((o) => visible(counts, selected, o));
  if (shown.length === 0) return null;
  return (
    <Section title={title} selectedCount={selected.length} onClear={() => onClear(facet)}>
      <div className="flex flex-wrap gap-2">
        {shown.map((o) => (
          <Chip
            key={o}
            checked={selected.includes(o)}
            onClick={() => onToggle(facet, o)}
            count={counts.get(o)}
          >
            {label(o)}
          </Chip>
        ))}
      </div>
    </Section>
  );
}

const SIZE_GROUP_LABEL = { in: 'Frame', cm: 'Road · cm', other: 'Wheel × frame & other' } as const;

function SizeFacet({ counts, selected, onToggle, onClear }: FacetCommon) {
  const groups = useMemo(() => {
    const by: Record<'in' | 'cm' | 'other', string[]> = { in: [], cm: [], other: [] };
    for (const key of counts.keys()) {
      if (!visible(counts, selected, key)) continue;
      by[key ? sizeGroup(key) : 'other'].push(key);
    }
    for (const g of Object.values(by)) g.sort(compareSizes);
    // "No size" last: it's a catalogue gap, not a size.
    by.other.sort((a, b) => (a === '' ? 1 : b === '' ? -1 : compareSizes(a, b)));
    return by;
  }, [counts, selected]);
  const any = groups.in.length + groups.cm.length + groups.other.length > 0;
  if (!any) return null;
  return (
    <Section title="Size" selectedCount={selected.length} onClear={() => onClear('size')}>
      <div className="space-y-3">
        {(['in', 'cm', 'other'] as const).map((g) =>
          groups[g].length === 0 ? null : (
            <div key={g}>
              <p className="text-[10px] font-black uppercase tracking-widest text-muted mb-1.5 px-1">
                {SIZE_GROUP_LABEL[g]}
              </p>
              <div className="flex flex-wrap gap-2">
                {groups[g].map((s) => (
                  <Chip
                    key={s}
                    checked={selected.includes(s)}
                    onClick={() => onToggle('size', s)}
                    count={counts.get(s)}
                  >
                    {s || 'No size'}
                  </Chip>
                ))}
              </div>
            </div>
          )
        )}
      </div>
    </Section>
  );
}

function ColorFacet({ counts, selected, onToggle, onClear }: FacetCommon) {
  const [expanded, setExpanded] = useState(false);
  const [query, setQuery] = useState('');
  const options = useMemo(
    () =>
      [...counts.keys()]
        .filter((k) => visible(counts, selected, k))
        .sort((a, b) => {
          if (a === '') return 1;
          if (b === '') return -1;
          return (counts.get(b)?.units ?? 0) - (counts.get(a)?.units ?? 0);
        }),
    [counts, selected]
  );
  if (options.length === 0) return null;
  const q = query.trim().toUpperCase();
  const filtered = q ? options.filter((o) => o.includes(q)) : options;
  const shown = expanded || q ? filtered : filtered.slice(0, COLLAPSED_LIMIT);
  // Ticked colours stay visible even when the list is collapsed.
  const extraSelected = selected.filter((s) => !shown.includes(s) && filtered.includes(s));

  return (
    <Section title="Color" selectedCount={selected.length} onClear={() => onClear('color')}>
      {options.length > COLLAPSED_LIMIT && <FacetSearch value={query} onChange={setQuery} />}
      <div className="space-y-0.5">
        {[...extraSelected, ...shown].map((c) => {
          const hex = c ? colorSwatch(c) : null;
          return (
            <CheckRow
              key={c || '∅'}
              checked={selected.includes(c)}
              onClick={() => onToggle('color', c)}
              count={counts.get(c)}
            >
              <span className="inline-flex items-center gap-2">
                <span
                  className="shrink-0 w-4 h-4 rounded-full border border-subtle"
                  style={{
                    background:
                      hex ?? 'conic-gradient(#ef4444, #eab308, #22c55e, #3b82f6, #a855f7, #ef4444)',
                  }}
                />
                {c ? titleCase(c) : 'No color'}
              </span>
            </CheckRow>
          );
        })}
      </div>
      {!q && filtered.length > COLLAPSED_LIMIT && (
        <ShowMore
          expanded={expanded}
          hidden={filtered.length - COLLAPSED_LIMIT}
          onClick={() => setExpanded((e) => !e)}
        />
      )}
    </Section>
  );
}

function TreeFacet({
  title,
  facet,
  parentPrefix,
  childPrefix,
  counts,
  selected,
  onToggle,
  onClear,
  parentLabel,
  childOf,
  order,
  searchable = false,
  defaultOpen = true,
}: FacetCommon & {
  title: string;
  facet: FacetId;
  parentPrefix: string;
  childPrefix: string;
  parentLabel: (key: string) => string;
  childOf: (child: string, parent: string) => boolean;
  /** 'units' = most stock first; an array = that fixed order. */
  order: 'units' | readonly string[];
  searchable?: boolean;
  defaultOpen?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState('');

  const { parents, children } = useMemo(() => {
    const parents: string[] = [];
    const children: string[] = [];
    for (const key of counts.keys()) {
      if (!visible(counts, selected, key)) continue;
      if (key.startsWith(parentPrefix)) parents.push(key.slice(parentPrefix.length));
      else if (key.startsWith(childPrefix)) children.push(key.slice(childPrefix.length));
    }
    const units = (p: string) => counts.get(parentPrefix + p)?.units ?? 0;
    if (order === 'units') {
      parents.sort((a, b) => (a === '' ? 1 : b === '' ? -1 : units(b) - units(a)));
    } else {
      parents.sort((a, b) => order.indexOf(a) - order.indexOf(b));
    }
    children.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    return { parents, children };
  }, [counts, selected, parentPrefix, childPrefix, order]);

  if (parents.length === 0) return null;

  const q = query.trim().toUpperCase();
  const matching = q
    ? parents.filter((p) => p.includes(q) || children.some((c) => childOf(c, p) && c.includes(q)))
    : parents;
  const limited = !q && !expanded && order === 'units';
  const shown = limited ? matching.slice(0, COLLAPSED_LIMIT) : matching;
  const extraSelected = matching.filter(
    (p) =>
      !shown.includes(p) &&
      (selected.includes(parentPrefix + p) ||
        children.some((c) => childOf(c, p) && selected.includes(childPrefix + c)))
  );

  return (
    <Section
      title={title}
      selectedCount={selected.length}
      onClear={() => onClear(facet)}
      defaultOpen={defaultOpen}
    >
      {searchable && parents.length > COLLAPSED_LIMIT && (
        <FacetSearch
          value={query}
          onChange={setQuery}
          placeholder={`Find a ${title.toLowerCase()}…`}
        />
      )}
      <div className="space-y-0.5">
        {[...extraSelected, ...shown].map((p) => {
          const kids = children.filter(
            (c) => childOf(c, p) && (!q || c.includes(q) || p.includes(q))
          );
          // A single child that is the parent itself (HUDSON → HUDSON) adds nothing.
          const showKids = kids.length > 1 || (kids.length === 1 && kids[0] !== p);
          const isOpen =
            open.has(p) ||
            (q !== '' && showKids) ||
            kids.some((k) => selected.includes(childPrefix + k));
          return (
            <div key={p || '∅'}>
              <CheckRow
                checked={selected.includes(parentPrefix + p)}
                onClick={() => onToggle(facet, parentPrefix + p)}
                count={counts.get(parentPrefix + p)}
                trailing={
                  showKids ? (
                    <button
                      onClick={() =>
                        setOpen((s) => {
                          const n = new Set(s);
                          if (n.has(p)) n.delete(p);
                          else n.add(p);
                          return n;
                        })
                      }
                      aria-label={isOpen ? 'Collapse' : 'Expand'}
                      className="shrink-0 p-2 rounded-lg text-muted hover:bg-card"
                    >
                      <ChevronRight
                        size={16}
                        className={`transition-transform ${isOpen ? 'rotate-90' : ''}`}
                      />
                    </button>
                  ) : (
                    <span className="w-8 shrink-0" />
                  )
                }
              >
                {parentLabel(p)}
                {showKids && (
                  <span className="ml-1.5 text-[10px] font-bold text-muted">{kids.length}</span>
                )}
              </CheckRow>
              {showKids &&
                isOpen &&
                kids.map((c) => (
                  <CheckRow
                    key={c}
                    indent
                    checked={
                      selected.includes(childPrefix + c) || selected.includes(parentPrefix + p)
                    }
                    onClick={() => onToggle(facet, childPrefix + c)}
                    count={counts.get(childPrefix + c)}
                    trailing={<span className="w-8 shrink-0" />}
                  >
                    {facet === 'model' ? titleCase(c) : c}
                  </CheckRow>
                ))}
            </div>
          );
        })}
      </div>
      {limited && matching.length > COLLAPSED_LIMIT && (
        <ShowMore
          expanded={expanded}
          hidden={matching.length - COLLAPSED_LIMIT}
          onClick={() => setExpanded((e) => !e)}
        />
      )}
    </Section>
  );
}

function FacetSearch({
  value,
  onChange,
  placeholder = 'Find…',
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <label className="flex items-center gap-2 mb-2 px-3 py-2 rounded-xl bg-card border border-subtle focus-within:border-accent">
      <Search size={14} className="text-muted shrink-0" />
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="flex-1 min-w-0 bg-transparent text-sm text-content placeholder:text-muted outline-none"
      />
      {value && (
        <button onClick={() => onChange('')} aria-label="Clear" className="text-muted">
          <X size={14} />
        </button>
      )}
    </label>
  );
}

function ShowMore({
  expanded,
  hidden,
  onClick,
}: {
  expanded: boolean;
  hidden: number;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="mt-1 ml-2 text-xs font-black uppercase tracking-widest text-accent hover:underline"
    >
      {expanded ? 'Show less' : `See ${hidden} more`}
    </button>
  );
}

// ── Tree membership ──────────────────────────────────────────────────────
// Re-derived rather than stored, so the tree can't disagree with the filter.

const lineCache = new Map<string, string>();
function modelBelongsTo(model: string, line: string): boolean {
  let l = lineCache.get(model);
  if (l === undefined) {
    l = modelLine(model);
    lineCache.set(model, l);
  }
  return l === line;
}
