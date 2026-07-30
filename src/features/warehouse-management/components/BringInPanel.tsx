// Step 1b: what gets hauled into the block from the rest of the warehouse.
//
// The blocks cannot be filled from their own contents — ROW 28-33 holds 8
// non-mover SKUs that reach a pallet, for 54 cells. Everything else has to come
// from somewhere else, and until now the screen had no way to even list it.
//
// The exclusions live here too, because this is the list they act on: filter to
// ROW 17, select it whole, rule it out as juvenile. One pass, and the SKUs stay
// out for good — the flag is on the SKU, not the row it happened to be in.

import React, { useMemo, useState } from 'react';
import { Ban, Check, Loader2, RotateCcw, X, AlertTriangle } from 'lucide-react';
import toast from 'react-hot-toast';
import { SearchInput } from '../../../components/ui/SearchInput';
import { useDebounce } from '../../../hooks/useDebounce';
import {
  EXCLUSION_REASONS,
  useBikeCandidates,
  useExcludeSkus,
  useUnexcludeSkus,
  type BikeCandidate,
} from '../hooks/useBikeCandidates';
import { useNoMovers, useSetNoMovers } from '../hooks/useNoMoverList';

interface BringInPanelProps {
  blockId: string;
  blockLabel: string;
  /** The block's own rows — those SKUs are already handled by the other tab. */
  blockRows: string[];
  minUnits: number;
  recencyDays: number;
}

function formatDate(iso: string | null): string {
  if (!iso) return 'never';
  return new Date(iso).toLocaleDateString([], { month: 'short', day: 'numeric' });
}

export const BringInPanel: React.FC<BringInPanelProps> = ({
  blockId,
  blockLabel,
  blockRows,
  minUnits,
  recencyDays,
}) => {
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [showExcluded, setShowExcluded] = useState(false);
  const [onlyPalletSized, setOnlyPalletSized] = useState(true);
  // Movers are hidden by default because they are not candidates, but they
  // still have to be reachable: an oversize bike that happens to be shipping
  // today is exactly the one worth ruling out before it goes quiet.
  const [showMovers, setShowMovers] = useState(false);
  const debouncedQuery = useDebounce(query, 200);

  const { data: candidates, isLoading, isError, error } = useBikeCandidates(recencyDays);
  const { data: listed } = useNoMovers();
  const setNoMovers = useSetNoMovers();
  const exclude = useExcludeSkus();
  const unexclude = useUnexcludeSkus();

  const listedSkus = useMemo(() => new Set((listed ?? []).map((n) => n.sku)), [listed]);
  const ownRows = useMemo(() => new Set(blockRows.map((r) => `ROW ${r}`)), [blockRows]);

  const rows = useMemo(() => {
    const q = debouncedQuery.trim().toLowerCase();
    return (candidates ?? [])
      .filter((c) => {
        if (c.isMover && !showMovers) return false;
        if (showExcluded !== (c.excludedReason !== null)) return false;
        if (onlyPalletSized && c.totalQty < minUnits) return false;
        // The block's own rows belong to the other tab, which now excludes too.
        if (ownRows.has(c.location)) return false;
        if (!q) return true;
        return (
          c.sku.toLowerCase().includes(q) ||
          (c.itemName ?? '').toLowerCase().includes(q) ||
          c.location.toLowerCase().includes(q)
        );
      })
      .sort((a, b) => b.totalQty - a.totalQty);
  }, [candidates, debouncedQuery, showExcluded, onlyPalletSized, showMovers, minUnits, ownRows]);

  const selectedRows = rows.filter((c) => selected.has(c.sku));
  const busy = setNoMovers.isPending || exclude.isPending || unexclude.isPending;

  const toggle = (sku: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(sku)) next.delete(sku);
      else next.add(sku);
      return next;
    });

  const selectAll = () =>
    setSelected(selected.size === rows.length ? new Set() : new Set(rows.map((c) => c.sku)));

  const handleAdd = async (picked: BikeCandidate[]) => {
    // A mover can be ruled out from this list but never brought in — the block
    // is for stock that does not move, and the floor would evict it anyway.
    const eligible = picked.filter((c) => !c.isMover);
    const skipped = picked.length - eligible.length;

    if (eligible.length === 0) {
      toast.error(
        skipped === 1
          ? 'That SKU is a mover — it cannot be brought into a block.'
          : 'Those SKUs are movers — they cannot be brought into a block.'
      );
      return;
    }

    await setNoMovers.mutateAsync(
      eligible.map((c) => ({
        sku: c.sku,
        blockId,
        lastShipped: c.lastShipped,
        qty: c.totalQty,
      }))
    );
    toast.success(
      `${eligible.length === 1 ? eligible[0].sku : `${eligible.length} SKUs`} → block ${blockId}` +
        (skipped > 0 ? ` · ${skipped} mover${skipped === 1 ? '' : 's'} skipped` : '')
    );
    setSelected(new Set());
  };

  const handleExclude = async (reason: string) => {
    const skus = selectedRows.map((c) => c.sku);
    if (skus.length === 0) return;
    await exclude.mutateAsync({ skus, reason });
    toast.success(`${skus.length} SKU${skus.length === 1 ? '' : 's'} excluded as ${reason}`);
    setSelected(new Set());
  };

  const handleRestore = async () => {
    const skus = selectedRows.map((c) => c.sku);
    if (skus.length === 0) return;
    await unexclude.mutateAsync(skus);
    toast.success(`${skus.length} SKU${skus.length === 1 ? '' : 's'} back in the pool`);
    setSelected(new Set());
  };

  // Movers are listed so they can be ruled out, never brought in, so they must
  // not inflate the count of what this list can actually contribute.
  const bringable = rows.filter((c) => !c.isMover);
  const totalPallets = bringable.reduce(
    (sum, c) => sum + Math.floor(c.totalQty / 25) + (c.totalQty % 25 >= minUnits ? 1 : 0),
    0
  );

  return (
    <div>
      <div className="flex flex-wrap items-center gap-3 mb-3">
        <div className="flex-1 min-w-[220px]">
          <SearchInput
            value={query}
            onChange={setQuery}
            placeholder="Search SKU, model, ROW…"
            variant="inline"
            preferenceId="warehouse-bring-in"
          />
        </div>

        <button
          onClick={() => {
            setOnlyPalletSized((v) => !v);
            setSelected(new Set());
          }}
          className={`px-2.5 py-1.5 rounded-md text-[11px] font-bold border transition-colors ${
            onlyPalletSized
              ? 'bg-slate-800 text-white border-slate-800'
              : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
          }`}
        >
          Only ≥ {minUnits}u
        </button>

        <button
          onClick={() => {
            setShowMovers((v) => !v);
            setSelected(new Set());
          }}
          title="Movers cannot be brought in, but they can be ruled out"
          className={`px-2.5 py-1.5 rounded-md text-[11px] font-bold border transition-colors ${
            showMovers
              ? 'bg-amber-500 text-white border-amber-500'
              : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
          }`}
        >
          Include movers
        </button>

        <button
          onClick={() => {
            setShowExcluded((v) => !v);
            setSelected(new Set());
          }}
          className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-[11px] font-bold border transition-colors ${
            showExcluded
              ? 'bg-rose-600 text-white border-rose-600'
              : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
          }`}
        >
          <Ban className="w-3 h-3" />
          Excluded
        </button>
      </div>

      {/* Bulk bar — this list is worked in sweeps, never one by one */}
      {selected.size > 0 && (
        <div className="flex flex-wrap items-center gap-2 mb-3 px-3 py-2 rounded-lg bg-slate-800 text-white text-xs">
          <span className="font-bold">{selected.size} selected</span>

          {showExcluded ? (
            <button
              onClick={handleRestore}
              disabled={busy}
              className="flex items-center gap-1 px-2.5 py-1 rounded-md bg-emerald-600 font-bold disabled:opacity-40"
            >
              <RotateCcw className="w-3 h-3" /> Restore to pool
            </button>
          ) : (
            <>
              <button
                onClick={() => handleAdd(selectedRows)}
                disabled={busy}
                className="px-2.5 py-1 rounded-md bg-emerald-600 font-bold disabled:opacity-40"
              >
                Bring into block {blockId}
              </button>
              <span className="text-slate-400">·</span>
              {EXCLUSION_REASONS.map((r) => (
                <button
                  key={r.id}
                  onClick={() => handleExclude(r.id)}
                  disabled={busy}
                  className="flex items-center gap-1 px-2.5 py-1 rounded-md bg-rose-600 font-bold disabled:opacity-40"
                  title={`Never place these in a block — ${r.hint}`}
                >
                  <Ban className="w-3 h-3" /> {r.label}
                </button>
              ))}
            </>
          )}

          <button
            onClick={() => setSelected(new Set())}
            className="ml-auto flex items-center gap-1 text-slate-300 hover:text-white"
          >
            <X className="w-3 h-3" /> Clear
          </button>
        </div>
      )}

      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="animate-spin text-emerald-600 w-6 h-6 opacity-30" />
        </div>
      ) : isError ? (
        <div className="flex items-center justify-center gap-2 py-12 text-rose-600 text-sm font-medium">
          <AlertTriangle className="w-4 h-4" />
          {(error as Error)?.message ?? 'Failed to load candidates.'}
        </div>
      ) : rows.length === 0 ? (
        <div className="text-center text-slate-400 text-sm py-12">
          {showExcluded
            ? 'Nothing excluded yet. Filter to ROW 17 or ROW 10 and rule them out.'
            : 'No bikes left to bring in with these filters.'}
        </div>
      ) : (
        <div className="rounded-xl border border-slate-200 overflow-hidden">
          <div className="flex items-center gap-3 px-3 py-2 bg-slate-50 border-b border-slate-200">
            <input
              type="checkbox"
              checked={selected.size === rows.length && rows.length > 0}
              onChange={selectAll}
              className="w-4 h-4 accent-emerald-600 shrink-0"
              aria-label="Select all"
            />
            <span className="text-[10px] font-extrabold uppercase tracking-wider text-slate-500">
              {showExcluded ? 'Excluded from every block' : `Available to bring into ${blockLabel}`}
            </span>
            <span className="text-xs text-slate-500">
              {rows.length} SKU · {rows.reduce((s, c) => s + c.totalQty, 0)}u
              {!showExcluded && ` · ${totalPallets} pallets to bring in`}
              {!showExcluded && rows.length !== bringable.length && (
                <span className="text-amber-700">
                  {' '}
                  · {rows.length - bringable.length} movers, not bringable
                </span>
              )}
            </span>
          </div>

          {rows.map((c) => (
            <div
              key={c.sku}
              className="flex items-center gap-3 px-3 py-2 border-b border-slate-100 hover:bg-slate-50"
            >
              <input
                type="checkbox"
                checked={selected.has(c.sku)}
                onChange={() => toggle(c.sku)}
                className="w-4 h-4 accent-emerald-600 shrink-0"
                aria-label={`Select ${c.sku}`}
              />
              <span className="font-mono font-bold text-xs w-28 shrink-0 text-slate-800">
                {c.sku}
              </span>
              <span className="text-xs text-slate-600 flex-1 min-w-0 truncate">{c.itemName}</span>
              <span className="text-xs font-bold w-20 shrink-0 text-slate-700">{c.location}</span>
              <span className="text-xs font-semibold w-14 text-right shrink-0 text-slate-700">
                {c.totalQty}u
              </span>
              <span className="text-xs text-slate-400 w-20 shrink-0">
                {formatDate(c.lastShipped)}
              </span>

              {c.excludedReason ? (
                <span className="w-28 shrink-0 text-[11px] font-bold text-rose-600">
                  {c.excludedReason}
                </span>
              ) : c.isMover ? (
                <span
                  className="w-28 shrink-0 text-[11px] font-bold text-amber-700"
                  title="Shipped inside the recency window — rule it out if it should never enter a block"
                >
                  mover
                </span>
              ) : listedSkus.has(c.sku) ? (
                <span className="flex items-center gap-1 w-28 shrink-0 text-[11px] font-bold text-emerald-700">
                  <Check className="w-3 h-3" /> in a block
                </span>
              ) : (
                <button
                  onClick={() => handleAdd([c])}
                  disabled={busy}
                  className="w-28 shrink-0 px-2.5 py-1 rounded-md text-[11px] font-bold bg-slate-100 text-slate-600 border border-slate-200 hover:bg-slate-200 disabled:opacity-40"
                >
                  Bring in
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
