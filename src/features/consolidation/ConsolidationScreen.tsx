import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import ArrowLeft from 'lucide-react/dist/esm/icons/arrow-left';
import Loader2 from 'lucide-react/dist/esm/icons/loader-2';
import RefreshCw from 'lucide-react/dist/esm/icons/refresh-cw';
import Boxes from 'lucide-react/dist/esm/icons/boxes';
import MoveRight from 'lucide-react/dist/esm/icons/move-right';
import { supabase } from '../../lib/supabase';
import { ConsolidationMoveModal } from './ConsolidationMoveModal';

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

export const ConsolidationScreen: React.FC = () => {
  const navigate = useNavigate();
  const [maxOrders, setMaxOrders] = useState(0);
  const [onlyBikes, setOnlyBikes] = useState(true);
  const [excludeDeepSlow, setExcludeDeepSlow] = useState(true);
  const [moving, setMoving] = useState<Candidate | null>(null);

  const {
    data: candidates = [],
    isLoading,
    isFetching,
    refetch,
  } = useQuery({
    queryKey: ['consolidation-candidates', maxOrders, onlyBikes],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_consolidation_candidates', {
        p_max_orders: maxOrders,
        p_only_bikes: onlyBikes,
      });
      if (error) throw error;
      return (data || []) as unknown as Candidate[];
    },
    staleTime: 60_000,
  });

  // Apply client-side deep-slow filter so toggling doesn't re-fetch.
  const filtered = useMemo(
    () =>
      excludeDeepSlow ? candidates.filter((c) => !DEEP_SLOW_ROWS.has(c.source_row)) : candidates,
    [candidates, excludeDeepSlow]
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

        {/* Filters */}
        <div className="flex flex-wrap items-center gap-2 text-[11px]">
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

          <div className="ml-auto text-muted font-bold uppercase tracking-wider">
            {totals.skus} SKUs · {totals.units}u · {totals.rows} rows
          </div>
        </div>
      </div>

      {/* List */}
      <div className="p-4 pb-24">
        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="animate-spin text-accent w-6 h-6 opacity-30" />
          </div>
        ) : grouped.length === 0 ? (
          <div className="text-center text-muted text-sm py-12">
            No candidates match the current filters.
          </div>
        ) : (
          grouped.map(([row, items]) => {
            const rowUnits = items.reduce((acc, i) => acc + i.qty, 0);
            return (
              <div key={row} className="mb-6">
                <div className="sticky top-[120px] z-[5] -mx-4 px-4 py-2 bg-surface/95 backdrop-blur border-b border-subtle">
                  <div className="flex items-center gap-2">
                    <h2 className="text-xs font-black uppercase tracking-widest text-content">
                      {row}
                    </h2>
                    <span className="text-[10px] text-muted font-bold uppercase">
                      {items.length} SKU · {rowUnits}u
                    </span>
                  </div>
                </div>

                <div className="mt-2 space-y-1">
                  {items.map((c) => (
                    <div
                      key={c.inventory_id}
                      className="bg-card border border-subtle rounded-xl p-3 flex items-center gap-3"
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-mono text-xs font-bold text-content">{c.sku}</span>
                          {c.alias_chain?.length > 1 && (
                            <span
                              className="text-[9px] px-1.5 py-0.5 rounded-md bg-amber-500/10 text-amber-500 font-bold uppercase"
                              title={`Aliases: ${c.alias_chain.join(', ')}`}
                            >
                              renamed
                            </span>
                          )}
                          <span className="text-[10px] text-muted font-bold uppercase">
                            {c.qty}u{c.sublocation?.length ? ` · ${c.sublocation.join('+')}` : ''}
                          </span>
                        </div>
                        {c.item_name && (
                          <div className="text-[11px] text-muted mt-0.5 truncate">
                            {c.item_name}
                          </div>
                        )}
                        <div className="flex items-center gap-2 mt-1 text-[10px] text-muted">
                          <span>
                            {c.orders_completed === 0
                              ? 'never shipped'
                              : `${c.orders_completed} order${c.orders_completed === 1 ? '' : 's'}`}
                          </span>
                          <span>·</span>
                          <span>{formatLastShipped(c.last_shipped)}</span>
                        </div>
                      </div>

                      <button
                        onClick={() => setMoving(c)}
                        className="px-3 py-2 rounded-lg bg-accent/10 border border-accent/30 text-accent text-[10px] font-bold uppercase flex items-center gap-1 hover:bg-accent/20 transition-colors"
                      >
                        <MoveRight size={12} />
                        Move
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            );
          })
        )}
      </div>

      {moving && (
        <ConsolidationMoveModal
          candidate={moving}
          onClose={() => setMoving(null)}
          onMoved={() => {
            setMoving(null);
            refetch();
          }}
        />
      )}
    </div>
  );
};

export default ConsolidationScreen;
