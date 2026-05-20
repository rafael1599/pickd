import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import ArrowLeft from 'lucide-react/dist/esm/icons/arrow-left';
import Loader2 from 'lucide-react/dist/esm/icons/loader-2';
import RefreshCw from 'lucide-react/dist/esm/icons/refresh-cw';
import Boxes from 'lucide-react/dist/esm/icons/boxes';
import MoveRight from 'lucide-react/dist/esm/icons/move-right';
import Check from 'lucide-react/dist/esm/icons/check';
import toast from 'react-hot-toast';
import { supabase } from '../../lib/supabase';
import { SearchInput } from '../../components/ui/SearchInput';
import { useDebounce } from '../../hooks/useDebounce';
import { useInventory } from '../inventory/hooks/InventoryProvider';
import { ItemDetailView } from '../inventory/components/ItemDetailView';
import { ConsolidationMoveModal } from './ConsolidationMoveModal';
import { searchCandidates } from './searchCandidates';
import type { InventoryItemInput, InventoryItemWithMetadata } from '../../schemas/inventory.schema';

interface Candidate {
  inventory_id: number;
  sku: string;
  item_name: string | null;
  warehouse: string;
  source_row: string;
  sublocation: string[] | null;
  qty: number;
  orders_completed: number;
  units_shipped: number | string;
  last_shipped: string | null;
  alias_chain: string[];
  /** Only populated in clear-row mode: 'active' or 'slow'. */
  suggested_zone?: 'active' | 'slow';
  /** Specific row chosen by the smart planner (NULL if no row fits). */
  suggested_row?: string | null;
  suggested_row_free?: number | null;
  suggested_row_picking_order?: number | null;
  suggestion_reason?: string | null;
}

const DEEP_SLOW_ROWS = new Set([
  'ROW 20',
  'ROW 21',
  'ROW 22',
  'ROW 23',
  'ROW 24',
  'ROW 25',
  'ROW 26',
  'ROW 27',
  'ROW 28',
  'ROW 29',
  'ROW 30',
  'ROW 31',
  'ROW 32',
  'ROW 33',
  'ROW 34',
]);

function rowSortKey(row: string): number {
  // Sort "ROW N" numerically; non-ROW rows sink to the end.
  const m = row.match(/^ROW\s+([\d.]+)/i);
  return m ? Number(m[1]) : 9999;
}

function formatLastShipped(iso: string | null): string {
  if (!iso) return 'never';
  const d = new Date(iso);
  const ms = Date.now() - d.getTime();
  const days = Math.floor(ms / 86_400_000);
  if (days === 0) return 'today';
  if (days === 1) return '1d ago';
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  return d.toLocaleDateString();
}

type ScreenMode = 'consolidate' | 'promote' | 'clear-row';

// Rows where consolidated items end up (slow zone).
const CONSOLIDATE_TARGETS = [
  'ROW 20',
  'ROW 21',
  'ROW 22',
  'ROW 23',
  'ROW 24',
  'ROW 25',
  'ROW 26',
  'ROW 27',
  'ROW 28',
  'ROW 29',
  'ROW 30',
  'ROW 31',
];
// Rows where promoted (high-rotation) items go (active zone near packing).
const PROMOTE_TARGETS = [
  'ROW 1',
  'ROW 2',
  'ROW 3',
  'ROW 4',
  'ROW 5',
  'ROW 6',
  'ROW 7',
  'ROW 8',
  'ROW 9',
  'ROW 10',
  'ROW 16',
];

export const ConsolidationScreen: React.FC = () => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { addItem, updateItem, deleteItem } = useInventory();
  const [mode, setMode] = useState<ScreenMode>('consolidate');
  const [maxOrders, setMaxOrders] = useState(0);
  const [minOrders, setMinOrders] = useState(2);
  const [onlyBikes, setOnlyBikes] = useState(true);
  const [excludeDeepSlow, setExcludeDeepSlow] = useState(true);
  /** Source row selected to be cleared (clear-row mode). Empty until picked. */
  const [clearRow, setClearRow] = useState<string>('');
  const [moving, setMoving] = useState<Candidate | null>(null);
  const [detailItem, setDetailItem] = useState<InventoryItemWithMetadata | null>(null);
  const [isDetailLoading, setIsDetailLoading] = useState(false);
  // Per-card selection. Tick → visual mark + Move button becomes active.
  // Unticked cards have their Move button disabled (prevents accidental moves).
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());

  const toggleSelected = (inventoryId: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(inventoryId)) next.delete(inventoryId);
      else next.add(inventoryId);
      return next;
    });
  };
  // SKUs that have just been moved — used to optimistically hide them
  // until the next refetch confirms the new state. Prevents the user from
  // re-clicking a stale row before react-query has refreshed.
  const [movedIds, setMovedIds] = useState<Set<number>>(new Set());
  const [searchQuery, setSearchQuery] = useState('');
  const debouncedSearch = useDebounce(searchQuery, 200);

  const {
    data: candidates = [],
    isLoading,
    isFetching,
    refetch,
  } = useQuery({
    queryKey: ['consolidation-candidates', mode, maxOrders, minOrders, onlyBikes, clearRow],
    queryFn: async () => {
      if (mode === 'consolidate') {
        const { data, error } = await supabase.rpc('get_consolidation_candidates', {
          p_max_orders: maxOrders,
          p_only_bikes: onlyBikes,
        });
        if (error) throw error;
        return (data || []) as unknown as Candidate[];
      }
      if (mode === 'promote') {
        const { data, error } = await supabase.rpc('get_promotion_candidates', {
          p_min_orders: minOrders,
          p_only_bikes: onlyBikes,
        });
        if (error) throw error;
        return (data || []) as unknown as Candidate[];
      }
      // clear-row: only run after the operator picks a source row.
      if (!clearRow) return [];
      const { data, error } = await supabase.rpc('get_clear_row_plan', {
        p_source_row: clearRow,
        p_only_bikes: onlyBikes,
      });
      if (error) throw error;
      return (data || []) as unknown as Candidate[];
    },
    // Tight staleness: after a move, neighbouring rows might show stale
    // qty/locations. Always refetch on focus / key change.
    staleTime: 0,
    refetchOnWindowFocus: true,
  });

  // Rows that currently have active bike inventory (used as options in the
  // clear-row picker). Includes unit count per row so the picker can sort
  // by "easiest to clear" and show the count under each chip.
  const { data: availableRows = [] } = useQuery({
    queryKey: ['consolidation-available-rows', onlyBikes],
    enabled: mode === 'clear-row',
    queryFn: async (): Promise<{ location: string; units: number; skus: number }[]> => {
      const q = supabase
        .from('inventory')
        .select('location, quantity, sku, sku_metadata!inner(is_bike)')
        .eq('is_active', true)
        .gt('quantity', 0);
      if (onlyBikes) q.eq('sku_metadata.is_bike', true);
      const { data, error } = await q;
      if (error) throw error;
      const byRow = new Map<string, { units: number; skus: Set<string> }>();
      for (const r of (data || []) as {
        location: string | null;
        quantity: number | null;
        sku: string | null;
      }[]) {
        if (!r.location || !/^ROW /.test(r.location)) continue;
        const entry = byRow.get(r.location) || { units: 0, skus: new Set() };
        entry.units += r.quantity || 0;
        if (r.sku) entry.skus.add(r.sku);
        byRow.set(r.location, entry);
      }
      return Array.from(byRow.entries())
        .map(([location, v]) => ({ location, units: v.units, skus: v.skus.size }))
        .sort((a, b) => rowSortKey(a.location) - rowSortKey(b.location));
    },
    staleTime: 60_000,
  });

  // Top 3 rows easiest to clear out (fewest total units). Surfaced as
  // a 'Quick picks' row above the full grid.
  const easiestToClear = useMemo(
    () =>
      [...availableRows]
        .filter((r) => r.units > 0)
        .sort((a, b) => a.units - b.units)
        .slice(0, 3),
    [availableRows]
  );

  // Apply client-side filters.
  //  - 'exclude deep slow' is only meaningful in consolidate mode (in
  //    promote mode the deep zone IS the source — we want it visible).
  //  - moved-ids hide is universal.
  const preSearch = useMemo(
    () =>
      candidates.filter((c) => {
        if (movedIds.has(c.inventory_id)) return false;
        if (mode === 'consolidate' && excludeDeepSlow && DEEP_SLOW_ROWS.has(c.source_row))
          return false;
        return true;
      }),
    [candidates, excludeDeepSlow, movedIds, mode]
  );

  const filtered = useMemo(
    () => searchCandidates(preSearch, debouncedSearch),
    [preSearch, debouncedSearch]
  );

  const grouped = useMemo(() => {
    const groups: Record<string, Candidate[]> = {};
    for (const c of filtered) {
      (groups[c.source_row] ||= []).push(c);
    }
    return Object.entries(groups).sort((a, b) => rowSortKey(a[0]) - rowSortKey(b[0]));
  }, [filtered]);

  const totals = useMemo(
    () => ({
      skus: filtered.length,
      units: filtered.reduce((acc, c) => acc + c.qty, 0),
      rows: grouped.length,
    }),
    [filtered, grouped]
  );

  // Card click → fetch the full inventory row + sku_metadata and open the
  // shared ItemDetailView (the same modal Stock uses). Avoids a navigation
  // jump out of Consolidation.
  const openDetail = async (c: Candidate) => {
    setIsDetailLoading(true);
    try {
      const { data, error } = await supabase
        .from('inventory')
        .select('*, sku_metadata(*)')
        .eq('id', c.inventory_id)
        .single();
      if (error) throw error;
      setDetailItem(data as unknown as InventoryItemWithMetadata);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not load item');
    } finally {
      setIsDetailLoading(false);
    }
  };

  const handleSaveDetail = async (
    formData: InventoryItemInput & { length_in?: number; width_in?: number; height_in?: number }
  ) => {
    if (!detailItem) return await addItem(formData.warehouse, formData);
    return await updateItem(detailItem, formData);
  };

  const handleDeleteDetail = () => {
    if (detailItem) {
      deleteItem(detailItem.warehouse, detailItem.sku, detailItem.location);
    }
  };

  return (
    <div className="min-h-screen bg-surface">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-surface border-b border-subtle px-4 py-3">
        <div className="flex items-center gap-2 mb-3">
          <button
            onClick={() => navigate('/')}
            className="p-2 -ml-2 rounded-xl text-muted hover:text-content"
            aria-label="Back"
          >
            <ArrowLeft size={18} />
          </button>
          <Boxes size={18} className="text-accent" />
          <h1 className="text-sm font-bold text-content uppercase tracking-tight flex-1">
            Consolidation
          </h1>
          <button
            onClick={() => refetch()}
            disabled={isFetching}
            className="p-2 rounded-xl text-muted hover:text-content disabled:opacity-30"
            aria-label="Refresh"
          >
            <RefreshCw size={14} className={isFetching ? 'animate-spin' : ''} />
          </button>
        </div>

        {/* Mode tabs */}
        <div className="flex items-center gap-1 bg-card border border-subtle rounded-xl p-1 mb-3">
          {(
            [
              ['consolidate', 'Send to slow', 'Slow movers → ROW 20–31'],
              ['promote', 'Bring to active', 'High movers stuck deep → ROW 1–10, 16'],
              ['clear-row', 'Clear a row', 'Empty a specific row; movers go active, idle go slow'],
            ] as [ScreenMode, string, string][]
          ).map(([m, label, hint]) => (
            <button
              key={m}
              onClick={() => {
                setMode(m);
                setSelectedIds(new Set());
              }}
              title={hint}
              className={`flex-1 px-2 py-2 rounded-lg text-[10px] md:text-[11px] font-black uppercase tracking-wider transition-colors ${
                mode === m ? 'bg-accent text-white' : 'text-muted hover:text-content'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Filters — adapt to mode */}
        <div className="flex flex-wrap items-center gap-2 text-[11px]">
          {mode === 'consolidate' && (
            <div className="flex items-center gap-1 bg-card border border-subtle rounded-xl p-1">
              <span className="px-2 text-muted uppercase font-bold">Max orders</span>
              {[0, 1, 2, 5].map((n) => (
                <button
                  key={n}
                  onClick={() => setMaxOrders(n)}
                  className={`px-2 py-1 rounded-lg font-bold uppercase transition-colors ${
                    maxOrders === n ? 'bg-accent text-white' : 'text-muted hover:text-content'
                  }`}
                >
                  ≤{n}
                </button>
              ))}
            </div>
          )}
          {mode === 'promote' && (
            <div className="flex items-center gap-1 bg-card border border-subtle rounded-xl p-1">
              <span className="px-2 text-muted uppercase font-bold">Min orders</span>
              {[2, 3, 5, 10].map((n) => (
                <button
                  key={n}
                  onClick={() => setMinOrders(n)}
                  className={`px-2 py-1 rounded-lg font-bold uppercase transition-colors ${
                    minOrders === n ? 'bg-accent text-white' : 'text-muted hover:text-content'
                  }`}
                >
                  ≥{n}
                </button>
              ))}
            </div>
          )}

          <button
            onClick={() => setOnlyBikes((v) => !v)}
            className={`px-3 py-2 rounded-xl border font-bold uppercase transition-colors ${
              onlyBikes
                ? 'bg-accent/10 border-accent/30 text-accent'
                : 'bg-card border-subtle text-muted'
            }`}
          >
            Bikes only
          </button>

          {mode === 'consolidate' && (
            <button
              onClick={() => setExcludeDeepSlow((v) => !v)}
              className={`px-3 py-2 rounded-xl border font-bold uppercase transition-colors ${
                excludeDeepSlow
                  ? 'bg-accent/10 border-accent/30 text-accent'
                  : 'bg-card border-subtle text-muted'
              }`}
              title="Hide rows already in the deep-slow zone (20–34)"
            >
              Exclude ROW 20–34
            </button>
          )}

          <div className="ml-auto text-muted font-bold uppercase tracking-wider">
            {totals.skus} SKUs · {totals.units}u · {totals.rows} rows
          </div>
        </div>

        {/* clear-row: pick the source row to empty out */}
        {mode === 'clear-row' && (
          <div className="mt-3">
            {easiestToClear.length > 0 && (
              <>
                <div className="text-[10px] text-muted font-bold uppercase tracking-widest mb-2 flex items-center gap-1.5">
                  <span className="text-emerald-500">★</span>
                  Easiest to clear
                  <span className="text-muted/60 font-normal normal-case">
                    · fewest units to relocate
                  </span>
                </div>
                <div className="grid grid-cols-3 gap-2 mb-3">
                  {easiestToClear.map((r) => (
                    <button
                      key={r.location}
                      onClick={() => {
                        setClearRow(r.location);
                        setSelectedIds(new Set());
                      }}
                      className={`p-2 rounded-xl border-2 text-left transition-colors active:scale-[0.97] ${
                        clearRow === r.location
                          ? 'bg-accent text-white border-accent shadow-md shadow-accent/20'
                          : 'bg-card border-emerald-500/40 text-content hover:border-emerald-500/70'
                      }`}
                    >
                      <div className="text-sm md:text-base font-black tracking-tight leading-none">
                        {r.location}
                      </div>
                      <div className="text-[9px] uppercase font-bold opacity-80 tracking-wider mt-1">
                        {r.units}u · {r.skus} SKU
                      </div>
                    </button>
                  ))}
                </div>
              </>
            )}

            <div className="text-[10px] text-muted font-bold uppercase tracking-widest mb-2">
              All rows
            </div>
            <div className="flex flex-wrap gap-1.5 max-h-32 overflow-y-auto">
              {availableRows.length === 0 ? (
                <span className="text-[11px] text-muted/60">Loading rows…</span>
              ) : (
                availableRows.map((r) => (
                  <button
                    key={r.location}
                    onClick={() => {
                      setClearRow(r.location);
                      setSelectedIds(new Set());
                    }}
                    className={`px-2 py-1 rounded-lg text-[10px] font-black uppercase tracking-tight transition-colors flex flex-col items-center gap-0 ${
                      clearRow === r.location
                        ? 'bg-accent text-white'
                        : 'bg-card border border-subtle text-content hover:border-accent/50'
                    }`}
                  >
                    <span>{r.location}</span>
                    <span
                      className={`text-[9px] font-bold opacity-80 normal-case tracking-normal ${clearRow === r.location ? 'text-white/80' : 'text-muted'}`}
                    >
                      {r.units}u
                    </span>
                  </button>
                ))
              )}
            </div>
            {!clearRow && (
              <p className="text-[10px] text-muted/70 mt-2">
                Pick a row above. The system then suggests{' '}
                <span className="text-accent">active</span> or{' '}
                <span className="text-accent">slow</span> destinations per SKU based on its movement
                history.
              </p>
            )}
          </div>
        )}

        {/* Search */}
        <div className="mt-3">
          <SearchInput
            value={searchQuery}
            onChange={setSearchQuery}
            placeholder="Search SKU, name, row, sublocation…"
            variant="inline"
            preferenceId="consolidation"
          />
        </div>
      </div>

      {/* List — pb-32 leaves room for the floating BottomNavigation. See
          .claude/skills/project-skills/pickd/ui-rules. */}
      <div className="p-4 pb-32">
        {mode === 'clear-row' && clearRow && filtered.length > 0 && (
          <SmartSuggestionsPanel
            candidates={filtered}
            onMove={(c) => setMoving(c)}
            isFetching={isFetching}
          />
        )}

        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="animate-spin text-accent w-6 h-6 opacity-30" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center text-muted text-sm py-12">
            {debouncedSearch
              ? `No matches for "${debouncedSearch}".`
              : mode === 'clear-row' && !clearRow
                ? 'Pick a row above to see its contents and suggested destinations.'
                : mode === 'clear-row'
                  ? `${clearRow} is already empty.`
                  : 'No candidates match the current filters.'}
          </div>
        ) : debouncedSearch ? (
          // Active search → flat list (ranked by search relevance, not grouped).
          <div className="space-y-2">
            {filtered.map((c) => (
              <ConsolidationCard
                key={c.inventory_id}
                candidate={c}
                showSourceRow={true}
                isFetching={isFetching}
                isSelected={selectedIds.has(c.inventory_id)}
                onToggleSelected={() => toggleSelected(c.inventory_id)}
                onMove={() => setMoving(c)}
                onOpenDetail={() => openDetail(c)}
              />
            ))}
          </div>
        ) : (
          grouped.map(([row, items]) => {
            const rowUnits = items.reduce((acc, i) => acc + i.qty, 0);
            // Hide the "N SKU · Mu" subtitle when the row has a single SKU —
            // the card itself already shows the qty. Avoids visual duplication.
            const showRowSummary = items.length > 1;
            return (
              <div key={row} className="mb-6">
                <div className="sticky top-[120px] z-[5] -mx-4 px-4 py-2 bg-surface/95 backdrop-blur border-b border-subtle">
                  <div className="flex items-center gap-2">
                    <h2 className="text-xs font-black uppercase tracking-widest text-content">
                      {row}
                    </h2>
                    {showRowSummary && (
                      <span className="text-[10px] text-muted font-bold uppercase">
                        {items.length} SKU · {rowUnits}u
                      </span>
                    )}
                  </div>
                </div>

                <div className="mt-2 space-y-2">
                  {items.map((c) => (
                    <ConsolidationCard
                      key={c.inventory_id}
                      candidate={c}
                      showSourceRow={false}
                      isFetching={isFetching}
                      isSelected={selectedIds.has(c.inventory_id)}
                      onToggleSelected={() => toggleSelected(c.inventory_id)}
                      onMove={() => setMoving(c)}
                      onOpenDetail={() => openDetail(c)}
                    />
                  ))}
                </div>
              </div>
            );
          })
        )}
      </div>

      <ItemDetailView
        isOpen={!!detailItem}
        onClose={() => setDetailItem(null)}
        onSave={handleSaveDetail}
        onDelete={handleDeleteDetail}
        initialData={detailItem}
        mode="edit"
        screenType={detailItem?.warehouse || 'LUDLOW'}
      />

      {isDetailLoading && (
        <div className="fixed inset-0 z-[105] bg-black/40 flex items-center justify-center pointer-events-none">
          <Loader2 className="animate-spin text-accent w-8 h-8 opacity-70" />
        </div>
      )}

      {moving && (
        <ConsolidationMoveModal
          candidate={moving}
          targetRows={
            mode === 'clear-row'
              ? moving.suggested_zone === 'active'
                ? PROMOTE_TARGETS
                : CONSOLIDATE_TARGETS
              : mode === 'consolidate'
                ? CONSOLIDATE_TARGETS
                : PROMOTE_TARGETS
          }
          modeLabel={
            mode === 'clear-row'
              ? moving.suggested_zone === 'active'
                ? 'active zone (suggested)'
                : 'slow zone (suggested)'
              : mode === 'consolidate'
                ? 'consolidation zone'
                : 'active zone'
          }
          suggestedRow={mode === 'clear-row' ? moving.suggested_row : null}
          onClose={() => setMoving(null)}
          onMoved={async (movedId) => {
            // Hide the row instantly so a fast double-click doesn't re-target
            // a stale candidate. Then invalidate the list query so any
            // sibling rows (same SKU split across locations, etc.) pick up
            // the fresh state from get_consolidation_candidates.
            setSelectedIds((prev) => {
              const next = new Set(prev);
              next.delete(movedId);
              return next;
            });
            setMovedIds((prev) => {
              const next = new Set(prev);
              next.add(movedId);
              return next;
            });
            setMoving(null);
            await queryClient.invalidateQueries({ queryKey: ['consolidation-candidates'] });
            // After refetch lands the row is gone; drop the optimistic id
            // so movedIds doesn't accumulate indefinitely.
            setMovedIds((prev) => {
              const next = new Set(prev);
              next.delete(movedId);
              return next;
            });
          }}
        />
      )}
    </div>
  );
};

export default ConsolidationScreen;

// ─────────────────────────────────────────────────────────────────────
// Smart Suggestions panel (clear-row mode)
// ─────────────────────────────────────────────────────────────────────
// Shown above the full list. For each SKU in the chosen source row, the
// backend RPC pre-computed a specific destination row based on movement
// + capacity + picking_order. This panel surfaces the recommendation
// prominently so the operator can act on it directly, with an info
// disclosure explaining the algorithm.

interface SmartSuggestionsPanelProps {
  candidates: Candidate[];
  onMove: (c: Candidate) => void;
  isFetching: boolean;
}

const SmartSuggestionsPanel: React.FC<SmartSuggestionsPanelProps> = ({
  candidates,
  onMove,
  isFetching,
}) => {
  const [showHow, setShowHow] = useState(false);
  const withSuggestion = candidates.filter((c) => c.suggested_row);
  const withoutSuggestion = candidates.filter((c) => !c.suggested_row);
  if (withSuggestion.length === 0 && withoutSuggestion.length === 0) return null;

  return (
    <div className="mb-6 bg-accent/5 border border-accent/30 rounded-2xl p-3">
      <div className="flex items-center justify-between mb-2">
        <div className="text-[11px] font-black uppercase tracking-widest text-accent">
          Smart suggestions
        </div>
        <button
          type="button"
          onClick={() => setShowHow((v) => !v)}
          className="text-[10px] text-muted hover:text-content font-bold uppercase tracking-wider"
        >
          {showHow ? 'Hide how' : 'How does this work?'}
        </button>
      </div>

      {showHow && (
        <div className="mb-3 text-[11px] text-muted/90 leading-relaxed bg-card border border-subtle rounded-xl p-3 space-y-1">
          <p>
            For each SKU in this row, the system picks a single destination by combining three
            signals:
          </p>
          <ul className="list-disc list-inside space-y-0.5">
            <li>
              <span className="text-content font-bold">Movement</span> — SKUs with ≥ 2 completed
              orders (rename-aware) are tagged <span className="text-emerald-500">active</span>; the
              rest <span className="text-blue-400">slow</span>.
            </li>
            <li>
              <span className="text-content font-bold">Capacity</span> — only rows with enough free
              units to fit the current qty are candidates.
            </li>
            <li>
              <span className="text-content font-bold">Picking order</span> — active SKUs head to
              the row with the <em>highest</em> picking_order (closest to packing); slow SKUs to the{' '}
              <em>lowest</em> (deepest into the warehouse).
            </li>
          </ul>
          <p>
            Tiebreak: if two rows have the same picking_order, the one with more free space wins
            (spreads load). You can still override the destination inside the Move modal.
          </p>
        </div>
      )}

      <div className="space-y-1.5">
        {withSuggestion.map((c) => (
          <div
            key={c.inventory_id}
            className="bg-card border border-subtle rounded-xl p-2 flex items-center gap-3"
          >
            <div className="flex flex-col items-center justify-center min-w-[3.5rem] shrink-0 border-r border-subtle pr-2">
              <span className="text-[8px] font-black uppercase tracking-widest text-muted/60 leading-none">
                QTY
              </span>
              <span className="text-2xl font-black tracking-tight leading-none text-content mt-0.5">
                {c.qty}
              </span>
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-mono text-xs font-bold text-content">{c.sku}</span>
                <span
                  className={`text-[9px] px-1.5 py-0.5 rounded-md font-black uppercase tracking-wider ${
                    c.suggested_zone === 'active'
                      ? 'bg-emerald-500/10 text-emerald-500'
                      : 'bg-blue-500/10 text-blue-400'
                  }`}
                >
                  → {c.suggested_row}
                </span>
              </div>
              <div className="text-[10px] text-muted/80 mt-0.5 truncate">{c.suggestion_reason}</div>
            </div>
            <button
              type="button"
              onClick={() => onMove(c)}
              disabled={isFetching}
              className="px-3 py-2 rounded-lg bg-accent text-white text-[10px] font-black uppercase tracking-wider flex items-center gap-1 hover:bg-accent/90 transition-colors disabled:opacity-30"
            >
              <MoveRight size={12} />
              Move
            </button>
          </div>
        ))}

        {withoutSuggestion.length > 0 && (
          <div className="mt-2 px-3 py-2 rounded-xl bg-amber-500/10 border border-amber-500/30 text-[11px] text-amber-500 font-medium">
            {withoutSuggestion.length} SKU{withoutSuggestion.length === 1 ? '' : 's'} could not be
            placed automatically — no row in the target zone has enough free space. Use the full
            list below to move them manually.
          </div>
        )}
      </div>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────
// Card
// ─────────────────────────────────────────────────────────────────────
// Two pieces of info dominate the layout: QTY (how many units to grab)
// and the SOURCE ROW + SUBLOCATION (where to find them). Everything else
// (movement stats, item name, alias chain) is secondary metadata.
//
// Whole card is clickable → opens the SKU's ItemDetailView. The Move
// button stopPropagations so it doesn't trigger the card click.

interface ConsolidationCardProps {
  candidate: Candidate;
  /** In flat-search mode we show the source row inside the card;
   *  in grouped-by-row mode the row header carries it already. */
  showSourceRow: boolean;
  isFetching: boolean;
  isSelected: boolean;
  onToggleSelected: () => void;
  onMove: () => void;
  onOpenDetail: () => void;
}

const ConsolidationCard: React.FC<ConsolidationCardProps> = ({
  candidate: c,
  showSourceRow,
  isFetching,
  isSelected,
  onToggleSelected,
  onMove,
  onOpenDetail,
}) => {
  const sub = c.sublocation?.length ? c.sublocation.join('+') : null;
  return (
    // div + role=button: the outer card needs to be clickable, but it
    // contains nested <button> elements (Move, checkbox). HTML disallows
    // nested buttons; using div + keyboard handlers keeps a11y intact.
    <div
      role="button"
      tabIndex={0}
      onClick={onOpenDetail}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onOpenDetail();
        }
      }}
      className={`w-full text-left rounded-2xl p-3 flex items-stretch gap-3 border transition-all cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-accent active:scale-[0.99] ${
        isSelected
          ? 'bg-accent/5 border-accent/50 shadow-md shadow-accent/10'
          : 'bg-card border-subtle hover:border-accent/40'
      }`}
    >
      {/* Left column: QTY + sublocation. The visually dominant block. */}
      <div className="flex flex-col items-center justify-center min-w-[5rem] shrink-0 border-r border-subtle pr-3 gap-1">
        <span className="text-[9px] font-black uppercase tracking-widest text-muted/60 leading-none">
          QTY
        </span>
        <span className="text-4xl md:text-5xl font-black tracking-tight leading-none text-content">
          {c.qty}
        </span>
        {sub && (
          <span className="mt-1 px-2 py-0.5 rounded-md bg-accent/10 text-accent text-base md:text-lg font-black uppercase tracking-tight leading-none">
            {sub}
          </span>
        )}
        {showSourceRow && (
          <span className="text-[9px] font-bold uppercase tracking-widest text-muted/70 leading-none mt-1">
            {c.source_row}
          </span>
        )}
      </div>

      {/* Middle column: SKU + name + metadata. */}
      <div className="flex-1 min-w-0 flex flex-col justify-center">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-black text-xl md:text-2xl tracking-tight leading-none text-content break-all">
            {c.sku}
          </span>
          {c.alias_chain?.length > 1 && (
            <span
              className="text-[9px] px-1.5 py-0.5 rounded-md bg-amber-500/10 text-amber-500 font-bold uppercase"
              title={`Aliases: ${c.alias_chain.join(', ')}`}
            >
              renamed
            </span>
          )}
          {c.suggested_zone && (
            <span
              className={`text-[9px] px-1.5 py-0.5 rounded-md font-black uppercase tracking-wider ${
                c.suggested_zone === 'active'
                  ? 'bg-emerald-500/10 text-emerald-500'
                  : 'bg-blue-500/10 text-blue-400'
              }`}
              title={
                c.suggested_zone === 'active'
                  ? 'Suggested: active zone (ROW 1–10, 16)'
                  : 'Suggested: slow zone (ROW 20–31)'
              }
            >
              → {c.suggested_zone}
            </span>
          )}
        </div>
        {c.item_name && (
          <div className="text-xs md:text-sm text-muted mt-1 leading-snug line-clamp-2">
            {c.item_name}
          </div>
        )}
        <div className="flex items-center gap-2 mt-1.5 text-[10px] text-muted/80">
          <span className="font-bold uppercase tracking-wider">
            {c.orders_completed === 0
              ? 'never shipped'
              : `${c.orders_completed} order${c.orders_completed === 1 ? '' : 's'}`}
          </span>
          {c.last_shipped && (
            <>
              <span>·</span>
              <span className="font-bold uppercase tracking-wider">
                {formatLastShipped(c.last_shipped)}
              </span>
            </>
          )}
        </div>
      </div>

      {/* Right column: checkbox + Move stacked, each filling 50% of the
       *  card height with a small aesthetic gap.
       *  Interaction:
       *   - First tap on EITHER → selects.
       *   - Selected state: checkbox deselects, Move opens the modal. */}
      <div className="flex flex-col gap-2 self-stretch w-20 shrink-0">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onToggleSelected();
          }}
          aria-label={isSelected ? 'Unselect' : 'Select to move'}
          className={`flex-1 rounded-xl border-2 flex items-center justify-center transition-colors ${
            isSelected
              ? 'bg-accent border-accent text-white'
              : 'bg-surface border-subtle hover:border-accent/60'
          }`}
        >
          {isSelected && <Check size={20} strokeWidth={3} />}
        </button>

        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            if (isSelected) onMove();
            else onToggleSelected();
          }}
          disabled={isFetching}
          className={`flex-1 rounded-xl border text-[11px] font-black uppercase tracking-wider flex flex-col items-center justify-center gap-0.5 transition-colors disabled:opacity-30 disabled:cursor-not-allowed ${
            isSelected
              ? 'bg-accent text-white border-accent hover:bg-accent/90'
              : 'bg-accent/10 text-accent border-accent/30 hover:bg-accent/20'
          }`}
        >
          <MoveRight size={18} />
          <span>Move</span>
        </button>
      </div>
    </div>
  );
};
