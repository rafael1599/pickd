// Step 1 of building the map: deciding what stays in the managed blocks.
//
// The planner used to pick its own occupants from a weighted score, with the
// knobs buried in a filter popover. That inverted the decision — the operation
// knows what should stay, the algorithm does not. Here the system only
// suggests, by shipment recency, and nothing enters the list without being
// confirmed (RF-001..006).

import React, { useMemo, useState } from 'react';
import { Loader2, RefreshCw, Check, X, AlertTriangle, Ban } from 'lucide-react';
import toast from 'react-hot-toast';
import { SearchInput } from '../../../components/ui/SearchInput';
import { useDebounce } from '../../../hooks/useDebounce';
import { BringInPanel } from './BringInPanel';
import { BLOCKS, DS_PALLET_MIN_DEFAULT } from '../../../utils/dsPalletPlanner';
import {
  useBlockSettings,
  useUpdateBlockSettings,
  useNoMovers,
  useSetNoMovers,
  useRemoveNoMovers,
  useBlockClassification,
  type ClassificationCandidate,
} from '../hooks/useNoMoverList';
import { EXCLUSION_REASONS, useExcludeSkus, useExcludedSkus } from '../hooks/useBikeCandidates';

const RECENCY_CHOICES = [30, 45, 60];

type QuickFilter = 'all' | 'single-unit' | 'never-shipped';

function formatDate(iso: string | null): string {
  if (!iso) return 'never';
  return new Date(iso).toLocaleDateString([], { month: 'short', day: 'numeric' });
}

/** What the block keeps, versus what it has to be given. */
type Scope = 'in-block' | 'bring-in';

export const NoMoverClassification: React.FC = () => {
  const [blockId, setBlockId] = useState(BLOCKS[0].id);
  const [scope, setScope] = useState<Scope>('in-block');
  const [query, setQuery] = useState('');
  const [quickFilter, setQuickFilter] = useState<QuickFilter>('all');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const debouncedQuery = useDebounce(query, 200);

  const block = BLOCKS.find((b) => b.id === blockId) ?? BLOCKS[0];

  const { data: settings, isLoading: loadingSettings } = useBlockSettings();
  const saved = settings?.[blockId];
  const savedRecency = saved?.recency_days ?? 30;
  const minUnits = saved?.min_units ?? DS_PALLET_MIN_DEFAULT;

  const [draftRecency, setDraftRecency] = useState<number | null>(null);
  const activeRecency = draftRecency ?? savedRecency;

  const updateSettings = useUpdateBlockSettings();
  const { data: listed } = useNoMovers();
  const setNoMovers = useSetNoMovers();
  const removeNoMovers = useRemoveNoMovers();
  const excludeSkus = useExcludeSkus();
  const { data: excluded } = useExcludedSkus();

  const {
    data: candidates,
    isLoading,
    isFetching,
    isError,
    error,
    refetch,
  } = useBlockClassification(block, activeRecency);

  // Only needed to answer "what changes if I move the window?" (RF-002c).
  const { data: atSaved } = useBlockClassification(block, savedRecency);

  const listedSkus = useMemo(() => new Set((listed ?? []).map((n) => n.sku)), [listed]);
  const excludedBySku = useMemo(
    () => new Map((excluded ?? []).map((e) => [e.sku, e.reason])),
    [excluded]
  );

  const { movers, nonMovers } = useMemo(() => {
    const q = debouncedQuery.trim().toLowerCase();
    const matches = (c: ClassificationCandidate) => {
      if (q && !c.sku.toLowerCase().includes(q) && !c.location.toLowerCase().includes(q)) {
        return false;
      }
      if (quickFilter === 'single-unit') return c.totalQty === 1;
      if (quickFilter === 'never-shipped') return c.lastShipped === null;
      return true;
    };

    const all = (candidates ?? []).filter(matches);
    return {
      movers: all.filter((c) => c.isMover).sort((a, b) => b.totalQty - a.totalQty),
      nonMovers: all.filter((c) => !c.isMover).sort((a, b) => b.totalQty - a.totalQty),
    };
  }, [candidates, debouncedQuery, quickFilter]);

  const recencyImpact = useMemo(() => {
    if (draftRecency === null || !candidates || !atSaved) return null;
    const before = new Map(atSaved.map((c) => [c.sku, c.isMover]));
    let changed = 0;
    for (const c of candidates) {
      if (before.has(c.sku) && before.get(c.sku) !== c.isMover) changed++;
    }
    return changed;
  }, [draftRecency, candidates, atSaved]);

  const toggleSelected = (sku: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(sku)) next.delete(sku);
      else next.add(sku);
      return next;
    });
  };

  const handleConfirm = async (rows: ClassificationCandidate[]) => {
    if (rows.length === 0) return;
    await setNoMovers.mutateAsync(
      rows.map((c) => ({
        sku: c.sku,
        blockId,
        lastShipped: c.lastShipped,
        qty: c.totalQty,
      }))
    );
    toast.success(
      rows.length === 1
        ? `${rows[0].sku} → no-mover, block ${blockId}`
        : `${rows.length} SKUs → no-movers, block ${blockId}`
    );
    setSelected(new Set());
  };

  const handleDiscard = async (skus: string[]) => {
    if (skus.length === 0) return;
    await removeNoMovers.mutateAsync(skus);
    toast.success(skus.length === 1 ? `${skus[0]} discarded` : `${skus.length} SKUs discarded`);
    setSelected(new Set());
  };

  // Reachable here as well as from Bring in, because a bike sitting in the
  // block's own rows never appears in that list — ROW 33's junk drawer would
  // otherwise have no way to be ruled out at all.
  const handleExclude = async (skus: string[], reason: string) => {
    if (skus.length === 0) return;
    await excludeSkus.mutateAsync({ skus, reason });
    toast.success(
      `${skus.length === 1 ? skus[0] : `${skus.length} SKUs`} excluded from every block (${reason})`
    );
    setSelected(new Set());
  };

  const applyRecency = async () => {
    if (draftRecency === null) return;
    await updateSettings.mutateAsync({ blockId, recency_days: draftRecency });
    toast.success(`Window set to ${draftRecency} days`);
    setDraftRecency(null);
  };

  const busy = setNoMovers.isPending || removeNoMovers.isPending || isFetching;

  const renderRow = (c: ClassificationCandidate, kind: 'mover' | 'non-mover') => {
    const inList = listedSkus.has(c.sku);
    const excludedReason = excludedBySku.get(c.sku);
    const destination = c.totalQty >= minUnits ? 'DS-Pallet' : `${c.totalQty}u < ${minUnits}u min`;

    return (
      <div
        key={c.sku}
        className="flex items-center gap-3 px-3 py-2 border-b border-slate-100 hover:bg-slate-50"
      >
        {kind === 'non-mover' && (
          <input
            type="checkbox"
            checked={selected.has(c.sku)}
            onChange={() => toggleSelected(c.sku)}
            className="w-4 h-4 accent-emerald-600 shrink-0"
            aria-label={`Select ${c.sku}`}
          />
        )}
        <span className="font-mono font-bold text-xs w-28 shrink-0 text-slate-800">{c.sku}</span>
        <span className="text-xs text-slate-500 w-24 shrink-0">
          {c.location}
          {c.sublocation?.length ? ` · ${c.sublocation.join('/')}` : ''}
        </span>
        <span className="text-xs font-semibold w-14 text-right shrink-0 text-slate-700">
          {c.totalQty}u
        </span>
        <span className="text-xs text-slate-400 w-24 shrink-0">{formatDate(c.lastShipped)}</span>
        <span
          className={`text-[11px] font-semibold w-32 shrink-0 ${
            c.totalQty >= minUnits ? 'text-emerald-700' : 'text-rose-600'
          }`}
        >
          {kind === 'non-mover' ? destination : ''}
        </span>

        <div className="ml-auto flex items-center gap-1.5 shrink-0">
          {excludedReason ? (
            <span className="flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-bold bg-rose-50 text-rose-700 border border-rose-200">
              <Ban className="w-3 h-3" /> {excludedReason}
            </span>
          ) : (
            <>
              {kind === 'non-mover' && (
                <button
                  onClick={() => (inList ? handleDiscard([c.sku]) : handleConfirm([c]))}
                  disabled={busy}
                  className={`flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-bold transition-colors disabled:opacity-40 ${
                    inList
                      ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                      : 'bg-slate-100 text-slate-600 border border-slate-200 hover:bg-slate-200'
                  }`}
                >
                  {inList ? <Check className="w-3 h-3" /> : null}
                  {inList ? 'In list' : 'Add'}
                </button>
              )}

              {/* Movers get this too: an oversize bike shipping today is exactly
                  the one worth ruling out before it goes quiet. */}
              {EXCLUSION_REASONS.map((r) => (
                <button
                  key={r.id}
                  onClick={() => handleExclude([c.sku], r.id)}
                  disabled={busy || excludeSkus.isPending}
                  title={`Never place ${c.sku} in a block — ${r.label.toLowerCase()}`}
                  className="flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-bold bg-white text-slate-500 border border-slate-200 hover:bg-rose-50 hover:text-rose-700 hover:border-rose-200 transition-colors disabled:opacity-40"
                >
                  <Ban className="w-3 h-3" />
                  {r.label}
                </button>
              ))}
            </>
          )}
        </div>
      </div>
    );
  };

  const listHeader = (label: string, count: number, units: number, accent: string) => (
    <div className="flex items-baseline gap-3 px-3 py-2 bg-slate-50 border-y border-slate-200">
      <span className={`text-[10px] font-extrabold uppercase tracking-wider ${accent}`}>
        {label}
      </span>
      <span className="text-xs text-slate-500">
        {count} SKU · {units}u
      </span>
    </div>
  );

  return (
    <div className="w-full h-full overflow-auto bg-white">
      <div className="p-6 pb-32">
        {/* Active criteria — visible, not buried in a popover (RF-002b/d) */}
        <div className="mb-5 rounded-xl border border-slate-200 bg-slate-50 p-4">
          <div className="text-[10px] font-extrabold uppercase tracking-wider text-slate-500 mb-2">
            Active criteria
          </div>

          <div className="flex flex-wrap items-center gap-x-6 gap-y-3 text-sm">
            <label className="flex items-center gap-2">
              <span className="text-slate-600">A mover shipped in the last</span>
              <select
                value={activeRecency}
                onChange={(e) => setDraftRecency(Number(e.target.value))}
                className="border border-slate-300 rounded-md px-2 py-1 text-sm font-semibold bg-white text-slate-800"
              >
                {RECENCY_CHOICES.map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </select>
              <span className="text-slate-600">days</span>
            </label>

            <label className="flex items-center gap-2">
              <span className="text-slate-600">A DS-Pallet needs at least</span>
              <input
                type="number"
                min={1}
                max={25}
                value={minUnits}
                onChange={(e) =>
                  updateSettings.mutate({ blockId, min_units: Number(e.target.value) })
                }
                className="border border-slate-300 rounded-md px-2 py-1 w-16 text-sm font-semibold bg-white text-slate-800"
              />
              <span className="text-slate-600">units</span>
            </label>
          </div>

          {draftRecency !== null && (
            <div className="mt-3 flex items-center gap-3 text-xs">
              <span className="text-amber-700">
                {recencyImpact === null
                  ? 'Calculating impact…'
                  : recencyImpact === 0
                    ? 'No SKU changes class with this window.'
                    : `${recencyImpact} SKU${recencyImpact === 1 ? '' : 's'} change class.`}
              </span>
              <button
                onClick={applyRecency}
                disabled={updateSettings.isPending}
                className="px-2.5 py-1 rounded-md bg-emerald-600 text-white font-bold disabled:opacity-40"
              >
                Apply
              </button>
              <button
                onClick={() => setDraftRecency(null)}
                className="px-2.5 py-1 rounded-md border border-slate-300 text-slate-600 font-semibold"
              >
                Cancel
              </button>
            </div>
          )}
        </div>

        {/* Block + scope */}
        <div className="flex flex-wrap items-center gap-3 mb-4">
          <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-lg border border-slate-200">
            {BLOCKS.map((b) => (
              <button
                key={b.id}
                onClick={() => {
                  setBlockId(b.id);
                  setSelected(new Set());
                  setDraftRecency(null);
                }}
                className={`px-3 py-1.5 rounded-md text-xs font-bold transition-all ${
                  b.id === blockId
                    ? 'bg-white text-slate-900 shadow-sm border border-slate-200/60'
                    : 'text-slate-500 hover:text-slate-800'
                }`}
              >
                {b.id} · {b.label}
              </button>
            ))}
          </div>

          {/* The block's own contents never fill it — the second scope is where
              the pallets actually come from, and where bikes get ruled out. */}
          <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-lg border border-slate-200">
            {(
              [
                ['in-block', 'In the block'],
                ['bring-in', 'Bring in'],
              ] as [Scope, string][]
            ).map(([id, label]) => (
              <button
                key={id}
                onClick={() => {
                  setScope(id);
                  setSelected(new Set());
                }}
                className={`px-3 py-1.5 rounded-md text-xs font-bold transition-all ${
                  scope === id
                    ? 'bg-white text-slate-900 shadow-sm border border-slate-200/60'
                    : 'text-slate-500 hover:text-slate-800'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {scope === 'bring-in' ? (
          <BringInPanel
            blockId={blockId}
            blockLabel={`block ${blockId} · ${block.label}`}
            blockRows={block.rows}
            minUnits={minUnits}
            recencyDays={activeRecency}
          />
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-3 mb-4">
              <div className="flex-1 min-w-[220px]">
                <SearchInput
                  value={query}
                  onChange={setQuery}
                  placeholder="Search SKU, row…"
                  variant="inline"
                  preferenceId="warehouse-no-movers"
                />
              </div>

              {(['all', 'single-unit', 'never-shipped'] as QuickFilter[]).map((f) => (
                <button
                  key={f}
                  onClick={() => setQuickFilter(f)}
                  className={`px-2.5 py-1.5 rounded-md text-[11px] font-bold border transition-colors ${
                    quickFilter === f
                      ? 'bg-slate-800 text-white border-slate-800'
                      : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                  }`}
                >
                  {f === 'all' ? 'All' : f === 'single-unit' ? 'Only 1 unit' : 'Never shipped'}
                </button>
              ))}

              <button
                onClick={() => refetch()}
                disabled={isFetching}
                className="flex items-center justify-center w-9 h-9 rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                title="Refresh"
              >
                <RefreshCw className={`w-4 h-4 ${isFetching ? 'animate-spin' : ''}`} />
              </button>
            </div>

            {/* Bulk bar — the long tail of 1-unit leftovers is unusable one by one */}
            {selected.size > 0 && (
              <div className="flex flex-wrap items-center gap-2 mb-3 px-3 py-2 rounded-lg bg-slate-800 text-white text-xs">
                <span className="font-bold">{selected.size} selected</span>
                <button
                  onClick={() => handleConfirm(nonMovers.filter((c) => selected.has(c.sku)))}
                  disabled={busy}
                  className="px-2.5 py-1 rounded-md bg-emerald-600 font-bold disabled:opacity-40"
                >
                  Add to list
                </button>
                <button
                  onClick={() => handleDiscard(Array.from(selected))}
                  disabled={busy}
                  className="px-2.5 py-1 rounded-md bg-rose-600 font-bold disabled:opacity-40"
                >
                  Discard
                </button>
                <span className="text-slate-400">·</span>
                {EXCLUSION_REASONS.map((r) => (
                  <button
                    key={r.id}
                    onClick={() => handleExclude(Array.from(selected), r.id)}
                    disabled={busy || excludeSkus.isPending}
                    title={`Never place these in a block — ${r.hint}`}
                    className="flex items-center gap-1 px-2.5 py-1 rounded-md bg-rose-800 font-bold disabled:opacity-40"
                  >
                    <Ban className="w-3 h-3" /> {r.label}
                  </button>
                ))}
                <button
                  onClick={() => setSelected(new Set())}
                  className="ml-auto flex items-center gap-1 text-slate-300 hover:text-white"
                >
                  <X className="w-3 h-3" /> Clear
                </button>
              </div>
            )}

            {/* States */}
            {isLoading || loadingSettings ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="animate-spin text-emerald-600 w-6 h-6 opacity-30" />
              </div>
            ) : isError ? (
              <div className="flex flex-col items-center gap-3 py-12">
                <div className="flex items-center gap-2 text-rose-600 text-sm font-medium">
                  <AlertTriangle className="w-4 h-4" />
                  {(error as Error)?.message ?? 'Failed to load candidates.'}
                </div>
                <button
                  onClick={() => refetch()}
                  className="px-3 py-1.5 rounded-md border border-slate-300 text-sm font-semibold"
                >
                  Retry
                </button>
              </div>
            ) : nonMovers.length === 0 && movers.length === 0 ? (
              <div className="text-center text-slate-400 text-sm py-12">
                {debouncedQuery
                  ? `No matches for "${debouncedQuery}".`
                  : quickFilter !== 'all'
                    ? 'No SKUs match this filter.'
                    : `No stock in block ${blockId}.`}
              </div>
            ) : (
              <div className="rounded-xl border border-slate-200 overflow-hidden">
                {listHeader(
                  'Non-movers — stay',
                  nonMovers.length,
                  nonMovers.reduce((s, c) => s + c.totalQty, 0),
                  'text-emerald-700'
                )}
                {nonMovers.map((c) => renderRow(c, 'non-mover'))}

                {listHeader(
                  'Movers — leave the block',
                  movers.length,
                  movers.reduce((s, c) => s + c.totalQty, 0),
                  'text-rose-600'
                )}
                {movers.map((c) => renderRow(c, 'mover'))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
};
