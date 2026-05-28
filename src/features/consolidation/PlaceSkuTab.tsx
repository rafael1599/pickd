import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import Search from 'lucide-react/dist/esm/icons/search';
import Loader2 from 'lucide-react/dist/esm/icons/loader-2';
import MapPin from 'lucide-react/dist/esm/icons/map-pin';
import { supabase } from '../../lib/supabase';
import { useDebounce } from '../../hooks/useDebounce';
import { DestinationList } from './components/DestinationList';

/**
 * "Where to put?" — given a SKU you have in hand, see ranked destination
 * locations to move it to.
 *
 * Flow:
 *  1. Operator types/searches the SKU.
 *  2. If the SKU has inventory, we list every current location (clickable
 *     "source" tiles). Auto-selected when there's only one.
 *  3. Below we show the top-N ranked destination locations from the
 *     `suggest_locations_for_sku` RPC, with score 0–100 and short reasons.
 *  4. Click a destination → parent's `onPickMove` opens the existing
 *     ConsolidationMoveModal with the chosen source row + pre-selected
 *     target.
 */

interface Suggestion {
  sku_orders_30d: number;
  sku_orders_90d: number;
  sku_total_qty: number;
  sku_last_order_at: string | null;

  location: string;
  picking_order: number | null;
  max_capacity: number;
  current_units: number;
  free_units: number;
  has_same_sku: boolean;
  same_sku_qty: number;

  score: number;
  position_pts: number;
  capacity_pts: number;
  consolidation_pts: number;
  reasons: string[];
}

export interface PlaceSkuSource {
  inventory_id: number;
  sku: string;
  item_name: string | null;
  warehouse: string;
  source_row: string;
  sublocation: string[] | null;
  qty: number;
}

interface InventoryRow {
  id: number;
  sku: string;
  warehouse: string;
  location: string;
  sublocation: string[] | null;
  quantity: number;
  item_name: string | null;
  sku_metadata: { image_url: string | null } | null;
}

interface Props {
  /** Open Move modal with this source row + the picked target row. */
  onPickMove: (source: PlaceSkuSource, targetRow: string) => void;
  /** Controlled search state (lifted to ConsolidationScreen so it survives
      tab switches — PlaceSkuTab unmounts when another tab is active). */
  query: string;
  setQuery: (q: string) => void;
  confirmed: boolean;
  setConfirmed: (c: boolean) => void;
}

// Mirror InventoryCard's thumbnail transform so the card looks identical to
// Stock / Send to slow cards.
function thumbUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  if (url.includes('/catalog/'))
    return url.replace('/catalog/', '/catalog/thumbs/').replace('.png', '.webp');
  if (url.includes('/photos/')) return url.replace('/photos/', '/photos/thumbs/');
  return url;
}

function formatLastOrder(iso: string | null): string {
  if (!iso) return 'never';
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (days <= 0) return 'today';
  if (days === 1) return '1d ago';
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  return new Date(iso).toLocaleDateString();
}

interface SkuSuggestion {
  sku: string;
  item_name: string | null;
  total_qty: number;
  location_count: number;
}

export const PlaceSkuTab: React.FC<Props> = ({
  onPickMove,
  query,
  setQuery,
  confirmed,
  setConfirmed,
}) => {
  const debounced = useDebounce(query.trim().toUpperCase(), 200);
  const [pickedSourceId, setPickedSourceId] = useState<number | null>(null);

  // Autocomplete: SKUs in active inventory matching the typed prefix/contains.
  // Only inventory we ALREADY HAVE — this tab is about placing existing stock,
  // not registering new SKUs. Dedupe by SKU and roll up qty / location count.
  const { data: skuMatches = [], isFetching: matchesFetching } = useQuery({
    queryKey: ['place-sku-autocomplete', debounced],
    enabled: !confirmed && debounced.length >= 1,
    queryFn: async (): Promise<SkuSuggestion[]> => {
      const { data, error } = await supabase
        .from('inventory')
        .select('sku, item_name, quantity, location')
        .ilike('sku', `%${debounced}%`)
        .eq('is_active', true)
        .gt('quantity', 0)
        .limit(80);
      if (error) throw error;
      const bySku = new Map<string, SkuSuggestion>();
      for (const r of data ?? []) {
        const key = r.sku;
        const existing = bySku.get(key);
        if (existing) {
          existing.total_qty += r.quantity ?? 0;
          existing.location_count += 1;
          if (!existing.item_name && r.item_name) existing.item_name = r.item_name;
        } else {
          bySku.set(key, {
            sku: key,
            item_name: r.item_name ?? null,
            total_qty: r.quantity ?? 0,
            location_count: 1,
          });
        }
      }
      // Sort: exact match first, then prefix matches, then by total_qty desc.
      return Array.from(bySku.values())
        .sort((a, b) => {
          const ax = a.sku === debounced ? 0 : a.sku.startsWith(debounced) ? 1 : 2;
          const bx = b.sku === debounced ? 0 : b.sku.startsWith(debounced) ? 1 : 2;
          if (ax !== bx) return ax - bx;
          return b.total_qty - a.total_qty;
        })
        .slice(0, 8);
    },
    staleTime: 30_000,
  });

  // Inventory rows for the confirmed SKU (where it currently lives).
  const { data: currentRows = [], isFetching: rowsFetching } = useQuery({
    queryKey: ['place-sku-current', debounced],
    enabled: confirmed && debounced.length > 0,
    queryFn: async (): Promise<InventoryRow[]> => {
      const { data, error } = await supabase
        .from('inventory')
        .select(
          'id, sku, warehouse, location, sublocation, quantity, item_name, sku_metadata(image_url)'
        )
        .eq('sku', debounced)
        .eq('is_active', true)
        .gt('quantity', 0);
      if (error) throw error;
      return (data ?? []) as unknown as InventoryRow[];
    },
    staleTime: 0,
  });

  // Ranked destination suggestions. Only runs once the user picks a concrete
  // SKU from the autocomplete (or types an exact match) — otherwise the RPC
  // fires on every keystroke and surfaces noisy "no inventory" suggestions
  // for partial prefixes.
  // SKU context (orders / stock / last order). Shares the queryKey with
  // DestinationList so react-query dedupes to a single RPC call. We only read
  // suggestions[0] here for the header card; the ranked list itself is
  // rendered by DestinationList.
  const { data: suggestions = [], isFetching: suggFetching } = useQuery({
    queryKey: ['suggest-locations', debounced],
    enabled: confirmed && debounced.length > 0,
    queryFn: async (): Promise<Suggestion[]> => {
      const { data, error } = await (
        supabase.rpc as unknown as (
          name: string,
          args: { p_sku: string; p_top_n: number }
        ) => Promise<{ data: Suggestion[] | null; error: Error | null }>
      )('suggest_locations_for_sku', { p_sku: debounced, p_top_n: 200 });
      if (error) throw error;
      return data ?? [];
    },
    staleTime: 0,
  });

  // Auto-select the only source if there's just one. We do this in a
  // memo+derived value rather than useEffect — no state sync needed.
  const effectiveSourceId = useMemo(() => {
    if (pickedSourceId && currentRows.some((r) => r.id === pickedSourceId)) return pickedSourceId;
    if (currentRows.length === 1) return currentRows[0].id;
    return null;
  }, [pickedSourceId, currentRows]);

  const source = currentRows.find((r) => r.id === effectiveSourceId) ?? null;
  const skuHeader = suggestions[0]; // every row repeats the same SKU context

  const handlePick = (targetRow: string) => {
    if (!source) return;
    onPickMove(
      {
        inventory_id: source.id,
        sku: source.sku,
        item_name: source.item_name ?? null,
        warehouse: source.warehouse,
        source_row: source.location,
        sublocation: source.sublocation,
        qty: source.quantity,
      },
      targetRow
    );
  };

  const confirmSku = (sku: string) => {
    setQuery(sku);
    setPickedSourceId(null);
    setConfirmed(true);
  };

  const resetSku = () => {
    setQuery('');
    setPickedSourceId(null);
    setConfirmed(false);
  };

  return (
    <div className="flex flex-col gap-3">
      {/* Search input */}
      <div className="relative">
        <Search
          size={16}
          className="absolute left-3 top-1/2 -translate-y-1/2 text-muted pointer-events-none"
        />
        <input
          type="text"
          autoFocus
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setPickedSourceId(null);
            // Any edit invalidates the previous confirmation — user is
            // searching again.
            setConfirmed(false);
          }}
          onKeyDown={(e) => {
            // Enter confirms top autocomplete match. Avoids forcing a click
            // on mobile or when scanning quickly.
            if (e.key === 'Enter' && !confirmed && skuMatches.length > 0) {
              e.preventDefault();
              confirmSku(skuMatches[0].sku);
            }
          }}
          placeholder="Type to search SKU (e.g. 0528 or 12-0528PR)"
          autoCapitalize="characters"
          autoCorrect="off"
          spellCheck={false}
          className="w-full bg-card border border-subtle rounded-xl pl-9 pr-3 py-2.5 text-sm font-mono text-content placeholder:text-muted/60 focus:outline-none focus:ring-1 focus:ring-accent uppercase tracking-wider"
        />
        {confirmed && (
          <button
            type="button"
            onClick={resetSku}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] font-bold uppercase tracking-widest text-muted hover:text-content px-2 py-1 rounded-md border border-subtle"
          >
            Change
          </button>
        )}
      </div>

      {!debounced && (
        <div className="text-center text-muted py-12 text-sm border border-dashed border-subtle rounded-2xl">
          Type a SKU to see where to put it.
        </div>
      )}

      {/* Autocomplete dropdown — only when actively searching, not yet
          confirmed. Operator can also press Enter to take the top match. */}
      {!confirmed && debounced.length >= 1 && (
        <div className="border border-subtle rounded-2xl bg-card overflow-hidden">
          {matchesFetching && skuMatches.length === 0 && (
            <div className="text-center text-muted py-6 text-xs">
              <Loader2 size={16} className="animate-spin inline" />
            </div>
          )}
          {!matchesFetching && skuMatches.length === 0 && (
            <div className="text-center text-muted py-6 text-xs px-3">
              No active stock matches{' '}
              <span className="font-mono font-bold text-content">{debounced}</span>. Register the
              SKU first via Stock → New Item.
            </div>
          )}
          {skuMatches.length > 0 && (
            <ul className="divide-y divide-subtle">
              {skuMatches.map((m) => (
                <li key={m.sku}>
                  <button
                    type="button"
                    onClick={() => confirmSku(m.sku)}
                    className="w-full text-left px-3 py-2 hover:bg-surface/60 active:bg-surface/80 transition-colors flex items-center gap-2"
                  >
                    <span className="font-mono font-black text-sm text-content uppercase">
                      {m.sku}
                    </span>
                    {m.item_name && (
                      <span className="text-xs text-muted truncate flex-1">{m.item_name}</span>
                    )}
                    <span className="text-[10px] font-bold uppercase tracking-widest text-muted shrink-0">
                      {m.total_qty}u · {m.location_count} loc
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {confirmed && debounced && (suggFetching || rowsFetching) && suggestions.length === 0 && (
        <div className="text-center text-muted py-12 text-sm">
          <Loader2 size={20} className="animate-spin inline" />
        </div>
      )}

      {/* Selected SKU card — same visual language as Stock / Send to slow
          cards: image thumbnail + SKU heading + name on the left, big stock
          number on the right, movement facts underneath. No velocity labels. */}
      {confirmed && (skuHeader || currentRows.length > 0) && (
        <div className="bg-card border border-subtle rounded-2xl p-3 flex gap-3 shadow-sm">
          {(() => {
            const thumb = thumbUrl(currentRows[0]?.sku_metadata?.image_url);
            return thumb ? (
              <img
                src={thumb}
                alt={debounced}
                loading="lazy"
                onError={(e) => {
                  (e.target as HTMLImageElement).style.display = 'none';
                }}
                className="w-[64px] object-contain rounded bg-white/5 flex-shrink-0 self-stretch"
              />
            ) : null;
          })()}

          <div className="flex-1 min-w-0 flex flex-col justify-center gap-1">
            <div
              className="text-lg font-extrabold text-content tracking-tighter leading-tight break-all"
              style={{ fontFamily: 'var(--font-heading)' }}
            >
              {debounced}
            </div>
            {currentRows[0]?.item_name && (
              <div className="text-xs text-muted truncate">{currentRows[0].item_name}</div>
            )}
            <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-muted mt-0.5">
              <span>
                <span className="font-bold text-content">{skuHeader?.sku_orders_30d ?? 0}</span> ord
                / 30d
              </span>
              <span className="text-subtle">·</span>
              <span>
                <span className="font-bold text-content">{skuHeader?.sku_orders_90d ?? 0}</span> /
                90d
              </span>
              <span className="text-subtle">·</span>
              <span>
                Last:{' '}
                <span className="font-bold text-content">
                  {formatLastOrder(skuHeader?.sku_last_order_at ?? null)}
                </span>
              </span>
            </div>
          </div>

          <div className="flex flex-col items-end justify-center gap-0.5 shrink-0">
            <span className="text-[9px] text-muted uppercase font-bold tracking-widest leading-none">
              Stock
            </span>
            <span className="text-2xl font-black text-accent tabular-nums tracking-tighter leading-none">
              {skuHeader?.sku_total_qty ?? currentRows.reduce((a, r) => a + r.quantity, 0)}
            </span>
            <span className="text-[9px] text-muted uppercase tracking-widest leading-none">
              units
            </span>
          </div>
        </div>
      )}

      {/* Current locations — pick a source */}
      {currentRows.length > 0 && (
        <div>
          <div className="text-[10px] font-black uppercase tracking-widest text-muted mb-1.5">
            Currently in {currentRows.length > 1 ? `${currentRows.length} locations` : '1 location'}{' '}
            — pick the source row to move FROM
          </div>
          <div className="flex flex-wrap gap-2">
            {currentRows.map((r) => {
              const active = r.id === effectiveSourceId;
              return (
                <button
                  key={r.id}
                  onClick={() => setPickedSourceId(r.id)}
                  className={`px-3 py-2 rounded-xl border text-left transition-colors ${
                    active
                      ? 'bg-accent/20 border-accent text-content'
                      : 'bg-card border-subtle text-muted hover:border-accent/40'
                  }`}
                >
                  <div className="flex items-center gap-1.5">
                    <MapPin size={12} />
                    <span className="font-bold text-sm">{r.location}</span>
                    {r.sublocation && r.sublocation.length > 0 && (
                      <span className="px-1.5 py-0.5 rounded-md bg-accent/10 text-accent text-[11px] font-black uppercase tracking-tight leading-none">
                        {r.sublocation.join('+')}
                      </span>
                    )}
                  </div>
                  <div className="text-[11px] mt-0.5">{r.quantity} units</div>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {debounced && currentRows.length === 0 && !rowsFetching && (
        <div className="text-amber-300 bg-amber-500/10 border border-amber-500/30 rounded-xl px-3 py-2 text-xs">
          SKU <span className="font-mono font-bold">{debounced}</span> has no active inventory. You
          can still see suggested destinations, but you'll need to register the stock first before
          moving anything.
        </div>
      )}

      {/* Ranked destinations — shared component (also used inline in Send to
          slow / Bring to active). */}
      {confirmed && (
        <DestinationList
          sku={debounced}
          sourceLocation={source?.location ?? null}
          enabled={!!source}
          hiddenRowsKey="mode_place-sku"
          onPick={handlePick}
          disabledHint={
            currentRows.length > 1 ? 'Pick a source row above to enable moves.' : undefined
          }
        />
      )}
    </div>
  );
};
