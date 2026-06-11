import { useEffect, useMemo, useState } from 'react';
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
import { searchBikeStock } from './stockFallback';
import { PlaceSkuTab } from './PlaceSkuTab';
import { HiddenRowsPicker } from './components/HiddenRowsPicker';
import { DestinationList } from './components/DestinationList';
import { useHiddenRows } from './hooks/useHiddenRows';
import { useQtyBucketFilter, matchesBucket, type QtyBucket } from './hooks/useQtyBucketFilter';
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

type ScreenMode = 'consolidate' | 'promote' | 'clear-row' | 'place-sku';

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

// idea-127: persist Consolidation work-state across sessions so the operator
// can leave and come back to exactly where they were. Filters that already
// live in their own localStorage hooks (useHiddenRows, useQtyBucketFilter)
// don't need to be re-persisted here.
interface PersistedConsolidationState {
  mode?: ScreenMode;
  maxOrders?: number;
  minOrders?: number;
  searchQuery?: string;
  placeSkuQuery?: string;
  placeSkuConfirmed?: boolean;
  clearRow?: string;
  movedIds?: number[];
  selectedIds?: number[];
  destForId?: number | null;
}
const PERSIST_KEY = 'consolidation_state_v1';

function loadPersisted(): PersistedConsolidationState {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(PERSIST_KEY);
    return raw ? (JSON.parse(raw) as PersistedConsolidationState) : {};
  } catch {
    return {};
  }
}

export const ConsolidationScreen: React.FC = () => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { addItem, updateItem, deleteItem } = useInventory();
  // Read once at mount — lazy initializers below hydrate from this snapshot.
  const persisted = useMemo(loadPersisted, []);
  const [mode, setMode] = useState<ScreenMode>(persisted.mode ?? 'consolidate');
  const [maxOrders, setMaxOrders] = useState(persisted.maxOrders ?? 0);
  const [minOrders, setMinOrders] = useState(persisted.minOrders ?? 2);
  // idea-115: "Bikes only" is now a hardcoded invariant — operations never
  // wants parts mixed into consolidation candidates. Keeping the const here
  // (instead of inlining `true` at every callsite) makes it trivial to
  // re-expose as a toggle later if a real use case shows up.
  const onlyBikes = true;
  // idea-117: per-tab user filter for "rows to hide from results". No default
  // seed anymore — the candidate RPCs now decide which SKUs are mis-slotted
  // via picking_order (a 0-order SKU already in a slow slot won't surface),
  // so the old DEEP_SLOW_ROWS name-based default-hide is redundant. Hidden
  // rows are now a pure user preference.
  const hiddenRowsApi = useHiddenRows(`mode_${mode}`, []);
  // idea-125: per-tab qty-bucket filter (Singles / Lines / 1 Tower / 1 Tower+).
  // Single-select, persisted, no default seed.
  const qtyBucketApi = useQtyBucketFilter(`mode_${mode}`);
  /** Source row selected to be cleared (clear-row mode). Empty until picked. */
  const [clearRow, setClearRow] = useState<string>(persisted.clearRow ?? '');
  const [moving, setMoving] = useState<Candidate | null>(null);
  // idea-122: candidate whose inline ranked-destination list is expanded in
  // Send to slow / Bring to active. Tapping "Move" toggles it; picking a
  // destination opens the move modal pre-targeted to that row.
  const [destFor, setDestFor] = useState<Candidate | null>(null);
  /** Pre-selected destination row when the move was triggered from
   *  PlaceSkuTab. Null in every other mode. */
  const [placeTargetRow, setPlaceTargetRow] = useState<string | null>(null);
  const [detailItem, setDetailItem] = useState<InventoryItemWithMetadata | null>(null);
  const [isDetailLoading, setIsDetailLoading] = useState(false);
  // Per-card selection. Tick → visual mark + Move button becomes active.
  // Unticked cards have their Move button disabled (prevents accidental moves).
  const [selectedIds, setSelectedIds] = useState<Set<number>>(
    () => new Set(persisted.selectedIds ?? [])
  );

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
  const [movedIds, setMovedIds] = useState<Set<number>>(() => new Set(persisted.movedIds ?? []));
  const [searchQuery, setSearchQuery] = useState(persisted.searchQuery ?? '');
  const debouncedSearch = useDebounce(searchQuery, 200);
  // idea-122: place-sku search lifted here so it survives tab switches
  // (PlaceSkuTab unmounts when another mode is active).
  const [placeSkuQuery, setPlaceSkuQuery] = useState(persisted.placeSkuQuery ?? '');
  const [placeSkuConfirmed, setPlaceSkuConfirmed] = useState(persisted.placeSkuConfirmed ?? false);
  // idea-127: deferred destFor restoration. The persisted blob only carries
  // the candidate's inventory_id; we resolve to the full Candidate once the
  // RPC returns its list. Cleared after the first resolution attempt so we
  // don't keep overwriting a user-initiated dismissal.
  const [pendingDestForId, setPendingDestForId] = useState<number | null>(
    persisted.destForId ?? null
  );

  // idea-127: write-through persistence. Stringifies the relevant slice of
  // state to localStorage every time anything inside changes. Filters that
  // own their own localStorage (useHiddenRows, useQtyBucketFilter) are NOT
  // duplicated here — they read/write from their own keys.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const payload: PersistedConsolidationState = {
      mode,
      maxOrders,
      minOrders,
      searchQuery,
      placeSkuQuery,
      placeSkuConfirmed,
      clearRow,
      movedIds: Array.from(movedIds),
      selectedIds: Array.from(selectedIds),
      destForId: destFor?.inventory_id ?? null,
    };
    try {
      window.localStorage.setItem(PERSIST_KEY, JSON.stringify(payload));
    } catch {
      // Quota or serialization issue — non-fatal, just lose this update.
    }
  }, [
    mode,
    maxOrders,
    minOrders,
    searchQuery,
    placeSkuQuery,
    placeSkuConfirmed,
    clearRow,
    movedIds,
    selectedIds,
    destFor,
  ]);

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

  // idea-127: once candidates land, re-attach the persisted destFor by id.
  // If the candidate no longer exists (already moved, filtered out, etc.) we
  // silently drop it. Clears the pending id on first attempt to avoid
  // re-applying it after the operator dismisses the inline list.
  useEffect(() => {
    if (pendingDestForId == null) return;
    if (candidates.length === 0) return;
    const found = candidates.find((c) => c.inventory_id === pendingDestForId);
    if (found && !destFor) setDestFor(found);
    setPendingDestForId(null);
  }, [candidates, pendingDestForId, destFor]);

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
  //  - moved-ids hide is universal (operator just moved them, don't re-show).
  //  - hidden-rows filter (idea-117) replaces the older "Exclude deep slow"
  //    binary toggle — operator chooses exactly which rows to hide per tab.
  const preSearch = useMemo(
    () =>
      candidates.filter((c) => {
        if (movedIds.has(c.inventory_id)) return false;
        if (hiddenRowsApi.isHidden(c.source_row)) return false;
        // idea-125: optional qty-bucket filter. When no bucket is active,
        // everything passes.
        if (qtyBucketApi.bucket && !matchesBucket(c.qty, qtyBucketApi.bucket)) return false;
        return true;
      }),
    [candidates, hiddenRowsApi, movedIds, qtyBucketApi.bucket]
  );

  // Canonical list of every ROW location in the warehouse — feeds the
  // HiddenRowsPicker so the operator can hide ANY row, not just the few that
  // happen to have candidates right now. Without this the picker looked empty
  // in clear-row mode (no candidates until a source is picked) and only
  // showed a handful of rows in consolidate/promote.
  const { data: allRowLocations = [] } = useQuery({
    queryKey: ['consolidation-all-rows'],
    queryFn: async (): Promise<string[]> => {
      const { data, error } = await supabase
        .from('locations')
        .select('location')
        .ilike('location', 'ROW%');
      if (error) throw error;
      const set = new Set<string>();
      for (const r of (data || []) as { location: string | null }[]) {
        if (r.location) set.add(r.location);
      }
      return Array.from(set);
    },
    staleTime: 5 * 60_000,
  });

  // Rows present in the raw candidate set — merged with the canonical list so
  // the picker always offers the full warehouse but also surfaces any ad-hoc
  // row that appears in data but isn't in `locations` (defensive).
  const hideablePresentRows = useMemo(() => {
    const set = new Set<string>(allRowLocations);
    for (const c of candidates) {
      if (!movedIds.has(c.inventory_id)) set.add(c.source_row);
    }
    return Array.from(set);
  }, [allRowLocations, candidates, movedIds]);

  const filtered = useMemo(
    () => searchCandidates(preSearch, debouncedSearch),
    [preSearch, debouncedSearch]
  );

  // idea-131: when the operator searches and NO candidate matches, look the
  // query up in the FULL bike stock and show where it lives — a search like
  // "03398" must never be a silent dead end just because that SKU isn't in
  // this mode's candidate set.
  const stockFallbackEnabled = !isLoading && !!debouncedSearch.trim() && filtered.length === 0;
  const { data: stockFallback = [], isLoading: isStockFallbackLoading } = useQuery({
    queryKey: ['consolidation-stock-fallback', debouncedSearch],
    queryFn: () => searchBikeStock(debouncedSearch),
    enabled: stockFallbackEnabled,
    staleTime: 60_000,
  });

  // Two-level grouping: row → sublocation → cards. Each (row, subloc) pair
  // gets its own sticky header so as the operator scrolls within a row,
  // the header swaps from "ROW 12 · A" to "ROW 12 · B" automatically when
  // cards from a different sublocation come into view. Sublocation arrays
  // are normalized to a sorted join ('+') so ['B','A'] and ['A','B'] share
  // a section. Empty sublocation sorts last so "no sub" cards group at the
  // bottom of each row.
  const grouped = useMemo(() => {
    const rows = new Map<string, Map<string, Candidate[]>>();
    for (const c of filtered) {
      const subKey = c.sublocation?.length ? [...c.sublocation].sort().join('+') : '';
      if (!rows.has(c.source_row)) rows.set(c.source_row, new Map());
      const subMap = rows.get(c.source_row)!;
      if (!subMap.has(subKey)) subMap.set(subKey, []);
      subMap.get(subKey)!.push(c);
    }
    return Array.from(rows.entries())
      .sort((a, b) => rowSortKey(a[0]) - rowSortKey(b[0]))
      .map(([row, subMap]) => {
        const sections = Array.from(subMap.entries()).sort(([a], [b]) => {
          if (a === '' && b !== '') return 1;
          if (b === '' && a !== '') return -1;
          return a.localeCompare(b);
        });
        return [row, sections] as const;
      });
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

  // idea-122: in Send to slow / Bring to active, "Move" expands a ranked
  // destination list inline (instead of jumping straight to the modal with
  // hardcoded target chips). Other modes keep the direct-modal behaviour.
  const isDestMode = mode === 'consolidate' || mode === 'promote';
  const handleCardMove = (c: Candidate) => {
    if (isDestMode) {
      setDestFor((prev) => (prev?.inventory_id === c.inventory_id ? null : c));
    } else {
      setMoving(c);
    }
  };
  const handleDestPick = (c: Candidate, targetRow: string) => {
    setPlaceTargetRow(targetRow);
    setMoving(c);
    setDestFor(null);
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
      {/* Header — scrolls away with the page so only the row label stays pinned. */}
      <div className="bg-surface border-b border-subtle px-4 py-3">
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
              [
                'place-sku',
                'Where to put?',
                'Search a SKU and see ranked destination rows to move it to',
              ],
              ['clear-row', 'Clear a row', 'Empty a specific row; movers go active, idle go slow'],
            ] as [ScreenMode, string, string][]
          ).map(([m, label, hint]) => (
            <button
              key={m}
              onClick={() => {
                setMode(m);
                setSelectedIds(new Set());
                setDestFor(null);
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

        {/* Filters — adapt to mode. Place-sku has its own search-driven
            UI below and doesn't use these filters at all. */}
        {mode !== 'place-sku' && (
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

            {/* "Bikes only" toggle removed (idea-115). Now hardcoded ON
                via the `onlyBikes` const above — parts are never desired
                in consolidation flows. */}

            {/* idea-125: qty-bucket single-select filter. Click the active
                bucket to clear it. Hidden in place-sku mode (which lists
                destinations, not candidates with qty). */}
            <div className="flex items-center gap-1 bg-card border border-subtle rounded-xl p-1">
              <span className="px-2 text-muted uppercase font-bold">Qty</span>
              {(
                [
                  { key: 'singles', label: 'Singles' },
                  { key: 'lines', label: 'Lines' },
                  { key: 'tower1', label: '1 Tower' },
                  { key: 'towerPlus', label: '1 Tower+' },
                ] as Array<{ key: QtyBucket; label: string }>
              ).map(({ key, label }) => {
                const active = qtyBucketApi.bucket === key;
                return (
                  <button
                    key={key}
                    onClick={() => qtyBucketApi.setBucket(active ? null : key)}
                    className={`px-2 py-1 rounded-lg font-bold uppercase transition-colors ${
                      active ? 'bg-accent text-white' : 'text-muted hover:text-content'
                    }`}
                    title={active ? 'Click to clear filter' : `Show only ${label.toLowerCase()}`}
                  >
                    {label}
                  </button>
                );
              })}
            </div>

            {/* idea-117: hide-rows picker. Replaces the prior binary
                "Exclude ROW 20-34" toggle with fine-grained multi-select.
                Available in every mode that lists candidates. */}
            {mode !== 'place-sku' && (
              <HiddenRowsPicker
                availableRows={hideablePresentRows}
                api={hiddenRowsApi}
                presets={
                  mode === 'consolidate'
                    ? [{ label: 'Deep slow 20-34', rows: Array.from(DEEP_SLOW_ROWS) }]
                    : []
                }
              />
            )}

            <div className="ml-auto text-muted font-bold uppercase tracking-wider">
              {totals.skus} SKUs · {totals.units}u · {totals.rows} rows
            </div>
          </div>
        )}

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

        {/* Search (hidden in place-sku — that tab uses its own SKU input) */}
        {mode !== 'place-sku' && (
          <div className="mt-3">
            <SearchInput
              value={searchQuery}
              onChange={setSearchQuery}
              placeholder="Search SKU, name, row, sublocation…"
              variant="inline"
              preferenceId="consolidation"
            />
          </div>
        )}
      </div>

      {/* Place-sku mode: SKU search + ranked destinations. The chosen
          destination becomes the moving target with the picked source row
          as the `Candidate`; we then fall through to the shared
          ConsolidationMoveModal below. */}
      {mode === 'place-sku' && (
        <div className="p-4 pb-32">
          <PlaceSkuTab
            query={placeSkuQuery}
            setQuery={setPlaceSkuQuery}
            confirmed={placeSkuConfirmed}
            setConfirmed={setPlaceSkuConfirmed}
            onPickMove={(source, targetRow) => {
              setPlaceTargetRow(targetRow);
              setMoving({
                inventory_id: source.inventory_id,
                sku: source.sku,
                item_name: source.item_name,
                warehouse: source.warehouse,
                source_row: source.source_row,
                sublocation: source.sublocation,
                qty: source.qty,
                // Place-sku doesn't classify via the consolidation/promote
                // RPCs, so these are unused but must exist on the Candidate
                // type. Picking sane defaults so the modal renders cleanly.
                orders_completed: 0,
                units_shipped: 0,
                last_shipped: null,
                alias_chain: [source.sku],
              });
            }}
          />
        </div>
      )}

      {/* List — pb-32 leaves room for the floating BottomNavigation. See
          .claude/skills/project-skills/pickd/ui-rules. */}
      {mode !== 'place-sku' && (
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
            <div className="py-12">
              <div className="text-center text-muted text-sm">
                {debouncedSearch
                  ? `No candidates match "${debouncedSearch}".`
                  : mode === 'clear-row' && !clearRow
                    ? 'Pick a row above to see its contents and suggested destinations.'
                    : mode === 'clear-row'
                      ? `${clearRow} is already empty.`
                      : 'No candidates match the current filters.'}
              </div>
              {/* idea-131: full-bike-stock fallback so the search is never a dead end */}
              {stockFallbackEnabled &&
                (isStockFallbackLoading ? (
                  <div className="flex items-center justify-center mt-6">
                    <Loader2 className="animate-spin text-accent w-5 h-5 opacity-30" />
                  </div>
                ) : stockFallback.length > 0 ? (
                  <div className="mt-6 max-w-xl mx-auto">
                    <div className="text-[11px] font-black uppercase tracking-widest text-muted/70 mb-2 px-1">
                      Found in bike stock (outside these candidates)
                    </div>
                    <div className="space-y-2">
                      {stockFallback.map((hit) => (
                        <div
                          key={hit.key}
                          className="flex items-center justify-between gap-3 bg-card border border-subtle rounded-xl px-3 py-2"
                        >
                          <div className="min-w-0">
                            <div className="font-black text-content tracking-tight">{hit.sku}</div>
                            {hit.item_name && (
                              <div className="text-xs text-muted uppercase tracking-wide truncate">
                                {hit.item_name}
                              </div>
                            )}
                          </div>
                          <div className="flex items-center gap-3 shrink-0">
                            <span className="font-mono font-black text-amber-500 text-lg">
                              {(hit.location || '—').toUpperCase()}
                              {hit.sublocation && hit.sublocation.length > 0 && (
                                <span className="ml-1">{hit.sublocation.join(',')}</span>
                              )}
                            </span>
                            <span className="text-xs font-black text-muted">×{hit.quantity}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className="text-center text-muted/60 text-xs mt-3">
                    Not found in the bike stock either.
                  </div>
                ))}
            </div>
          ) : debouncedSearch ? (
            // Active search → flat list (ranked by search relevance, not grouped).
            <div className="space-y-2">
              {filtered.map((c) => (
                <div key={c.inventory_id}>
                  <ConsolidationCard
                    candidate={c}
                    showSourceRow={true}
                    isFetching={isFetching}
                    isSelected={selectedIds.has(c.inventory_id)}
                    onToggleSelected={() => toggleSelected(c.inventory_id)}
                    onMove={() => handleCardMove(c)}
                    onOpenDetail={() => openDetail(c)}
                  />
                  {destFor?.inventory_id === c.inventory_id && (
                    <div className="mt-2 mb-1 pl-3 border-l-2 border-accent/40">
                      <DestinationList
                        sku={c.sku}
                        sourceLocation={c.source_row}
                        enabled
                        hiddenRowsKey={`dest_${mode}`}
                        onPick={(row) => handleDestPick(c, row)}
                      />
                    </div>
                  )}
                </div>
              ))}
            </div>
          ) : (
            grouped.map(([row, sections]) => (
              <div key={row} className="mb-6">
                {sections.map(([subKey, items]) => {
                  const sectionUnits = items.reduce((acc, i) => acc + i.qty, 0);
                  // Hide the "N SKU · Mu" subtitle when the section has a
                  // single SKU — the card itself already shows the qty.
                  const showSectionSummary = items.length > 1;
                  return (
                    <div key={`${row}::${subKey}`} className="mb-3">
                      {/* One sticky header per (row, subloc) — when the
                          operator scrolls past section A, B's header
                          replaces it at the top, so the "where am I"
                          context updates automatically. */}
                      <div className="sticky top-0 z-20 -mx-4 px-4 py-2 bg-surface/95 backdrop-blur border-b border-subtle">
                        <div className="flex items-center gap-2">
                          <h2 className="text-xs font-black uppercase tracking-widest text-content">
                            {row}
                          </h2>
                          {subKey && (
                            <span className="px-1.5 py-0.5 rounded-md bg-accent/15 text-accent text-[11px] font-black uppercase tracking-tight leading-none">
                              {subKey}
                            </span>
                          )}
                          {showSectionSummary && (
                            <span className="text-[10px] text-muted font-bold uppercase">
                              {items.length} SKU · {sectionUnits}u
                            </span>
                          )}
                        </div>
                      </div>

                      <div className="mt-2 space-y-2">
                        {items.map((c) => (
                          <div key={c.inventory_id}>
                            <ConsolidationCard
                              candidate={c}
                              showSourceRow={false}
                              isFetching={isFetching}
                              isSelected={selectedIds.has(c.inventory_id)}
                              onToggleSelected={() => toggleSelected(c.inventory_id)}
                              onMove={() => handleCardMove(c)}
                              onOpenDetail={() => openDetail(c)}
                            />
                            {destFor?.inventory_id === c.inventory_id && (
                              <div className="mt-2 mb-1 pl-3 border-l-2 border-accent/40">
                                <DestinationList
                                  sku={c.sku}
                                  sourceLocation={c.source_row}
                                  enabled
                                  hiddenRowsKey={`dest_${mode}`}
                                  onPick={(row) => handleDestPick(c, row)}
                                />
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            ))
          )}
        </div>
      )}

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
            // Always include the inline-picked row so it shows as a chip even
            // if it's outside the hardcoded zone lists (e.g. ROW 42).
            Array.from(
              new Set(
                [
                  ...(placeTargetRow ? [placeTargetRow] : []),
                  ...(mode === 'place-sku'
                    ? [...PROMOTE_TARGETS, ...CONSOLIDATE_TARGETS]
                    : mode === 'clear-row'
                      ? moving.suggested_zone === 'active'
                        ? PROMOTE_TARGETS
                        : CONSOLIDATE_TARGETS
                      : mode === 'consolidate'
                        ? CONSOLIDATE_TARGETS
                        : PROMOTE_TARGETS),
                ].filter(Boolean)
              )
            )
          }
          modeLabel={
            mode === 'place-sku'
              ? 'suggested destination'
              : mode === 'clear-row'
                ? moving.suggested_zone === 'active'
                  ? 'active zone (suggested)'
                  : 'slow zone (suggested)'
                : mode === 'consolidate'
                  ? 'consolidation zone'
                  : 'active zone'
          }
          suggestedRow={
            // placeTargetRow is set both by Where to put? and by picking a
            // ranked destination inline in Send to slow / Bring to active.
            placeTargetRow ?? (mode === 'clear-row' ? moving.suggested_row : null)
          }
          onClose={() => {
            setMoving(null);
            setPlaceTargetRow(null);
          }}
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
            setPlaceTargetRow(null);
            await queryClient.invalidateQueries({ queryKey: ['consolidation-candidates'] });
            // Place-sku reads from inventory + suggest_locations_for_sku;
            // both depend on the post-move inventory state. Invalidate so
            // the operator can immediately follow up with another move.
            await queryClient.invalidateQueries({ queryKey: ['place-sku-current'] });
            await queryClient.invalidateQueries({ queryKey: ['place-sku-suggestions'] });
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
      {/* Left column: QTY only. source_row stays here as a small footer when
          the card lives outside a grouped section (search mode); sublocation
          moved to the middle column next to the row badge to keep "where it
          is" reading as one unit. */}
      <div className="flex flex-col items-center justify-center min-w-[5rem] shrink-0 border-r border-subtle pr-3 gap-1">
        <span className="text-[9px] font-black uppercase tracking-widest text-muted/60 leading-none">
          QTY
        </span>
        <span className="text-4xl md:text-5xl font-black tracking-tight leading-none text-content">
          {c.qty}
        </span>
      </div>

      {/* Middle column: SKU + name + metadata. */}
      <div className="flex-1 min-w-0 flex flex-col justify-center">
        <div className="flex items-center gap-2 flex-wrap">
          {/* Location badge — sublocation chip sits inline to the right of
              the ROW label so the operator reads "ROW 12 · A" as one unit.
              In grouped mode (showSourceRow=false) we still show the chip
              alone because the ROW name lives in the sticky group header
              right above, and the chip is the per-card variant. */}
          {(showSourceRow || sub) && (
            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-surface/80 border border-subtle text-muted text-[10px] font-black uppercase tracking-widest leading-none">
              {showSourceRow && <span>{c.source_row}</span>}
              {sub && <span className="px-1 rounded bg-accent/15 text-accent">{sub}</span>}
            </span>
          )}
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
