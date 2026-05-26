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
import { PlaceSkuTab } from './PlaceSkuTab';
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

type ScreenMode = 'consolidate' | 'promote' | 'place-sku';

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
  const [moving, setMoving] = useState<Candidate | null>(null);
  /** Pre-selected destination row when the move was triggered from
   *  PlaceSkuTab. Null in every other mode. */
  const [placeTargetRow, setPlaceTargetRow] = useState<string | null>(null);
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
    queryKey: ['consolidation-candidates', mode, maxOrders, minOrders, onlyBikes],
    queryFn: async () => {
      if (mode === 'consolidate') {
        const { data, error } = await supabase.rpc('get_consolidation_candidates', {
          p_max_orders: maxOrders,
          p_only_bikes: onlyBikes,
        });
        if (error) throw error;
        return (data || []) as unknown as Candidate[];
      }
      // promote
      const { data, error } = await supabase.rpc('get_promotion_candidates', {
        p_min_orders: minOrders,
        p_only_bikes: onlyBikes,
      });
      if (error) throw error;
      return (data || []) as unknown as Candidate[];
    },
    // Tight staleness: after a move, neighbouring rows might show stale
    // qty/locations. Always refetch on focus / key change.
    staleTime: 0,
    refetchOnWindowFocus: true,
    enabled: mode !== 'place-sku',
  });

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
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="animate-spin text-accent w-6 h-6 opacity-30" />
            </div>
          ) : filtered.length === 0 ? (
            <div className="text-center text-muted text-sm py-12">
              {debouncedSearch
                ? `No matches for "${debouncedSearch}".`
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
                  <div className="sticky top-0 z-20 -mx-4 px-4 py-2 bg-surface/95 backdrop-blur border-b border-subtle">
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
            mode === 'place-sku'
              ? // Place-sku: surface BOTH active + slow zones as tiles so the
                // operator can override the suggestion without typing.
                Array.from(new Set([...PROMOTE_TARGETS, ...CONSOLIDATE_TARGETS]))
              : mode === 'consolidate'
                ? CONSOLIDATE_TARGETS
                : PROMOTE_TARGETS
          }
          modeLabel={
            mode === 'place-sku'
              ? 'suggested destination'
              : mode === 'consolidate'
                ? 'consolidation zone'
                : 'active zone'
          }
          suggestedRow={mode === 'place-sku' ? placeTargetRow : null}
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
