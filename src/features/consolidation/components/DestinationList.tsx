// idea-122 — shared "ranked destination rows" list. Used by Where to put?
// and (inline) by Send to slow / Bring to active when a SKU is selected.
//
// Given a SKU, calls suggest_locations_for_sku (picking_order ranked, no zone
// labels), shows the top picks with a "show all" expander and a per-context
// hide-rows filter. Clicking a destination calls onPick(targetRow).

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useHiddenRows } from '../hooks/useHiddenRows';
import { HiddenRowsPicker } from './HiddenRowsPicker';
import { supabase } from '../../../lib/supabase';

export interface DestinationSuggestion {
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

function scoreColor(score: number): string {
  if (score >= 70) return 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40';
  if (score >= 40) return 'bg-amber-500/20 text-amber-300 border-amber-500/40';
  return 'bg-zinc-700/40 text-muted border-subtle';
}

interface DestinationListProps {
  /** The SKU to rank destinations for. Empty disables the query. */
  sku: string;
  /** Current row of the source being moved — hidden from the list (no-op
      self-move) and the proximity signal. Null when unknown. */
  sourceLocation?: string | null;
  /** Whether a destination can be picked (e.g. a source row is selected). */
  enabled?: boolean;
  /** localStorage key for this context's hidden-rows preference. */
  hiddenRowsKey: string;
  /** Called with the chosen destination row. */
  onPick: (targetRow: string) => void;
  /** Shown under the list when !enabled. */
  disabledHint?: string;
}

const TOP_PICKS = 12;

// idea-124: "Hide full rows" — a row with no free capacity can't receive the
// item, so it's dead weight in the ranked list. Default ON; persisted per
// context so the operator's choice sticks.
function loadHideFull(key: string): boolean {
  if (typeof window === 'undefined') return true;
  const raw = window.localStorage.getItem(`hide_full_${key}`);
  return raw === null ? true : raw === '1';
}

export const DestinationList: React.FC<DestinationListProps> = ({
  sku,
  sourceLocation = null,
  enabled = true,
  hiddenRowsKey,
  onPick,
  disabledHint,
}) => {
  const [showAll, setShowAll] = useState(false);
  const [hideFull, setHideFull] = useState(() => loadHideFull(hiddenRowsKey));
  const hiddenRowsApi = useHiddenRows(hiddenRowsKey, []);

  const toggleHideFull = () => {
    setHideFull((v) => {
      const next = !v;
      if (typeof window !== 'undefined') {
        window.localStorage.setItem(`hide_full_${hiddenRowsKey}`, next ? '1' : '0');
      }
      return next;
    });
  };

  const { data: suggestions = [], isFetching } = useQuery({
    queryKey: ['suggest-locations', sku],
    enabled: sku.length > 0,
    staleTime: 0,
    queryFn: async (): Promise<DestinationSuggestion[]> => {
      const { data, error } = await (
        supabase.rpc as unknown as (
          name: string,
          args: { p_sku: string; p_top_n: number }
        ) => Promise<{ data: DestinationSuggestion[] | null; error: Error | null }>
      )('suggest_locations_for_sku', { p_sku: sku, p_top_n: 200 });
      if (error) throw error;
      return data ?? [];
    },
  });

  const availableRows = Array.from(new Set(suggestions.map((s) => s.location)));
  const visible = suggestions.filter(
    (s) =>
      s.location !== sourceLocation &&
      !hiddenRowsApi.isHidden(s.location) &&
      (!hideFull || s.free_units > 0)
  );
  const displayed = showAll ? visible : visible.slice(0, TOP_PICKS);
  const hasMore = visible.length > TOP_PICKS;

  if (sku.length === 0) return null;

  if (isFetching && suggestions.length === 0) {
    return <div className="text-center text-muted py-6 text-xs">Loading destinations…</div>;
  }

  if (visible.length === 0) {
    return (
      <div className="text-center text-muted py-6 text-xs">No destination rows to suggest.</div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-1.5 gap-2">
        <span className="text-[10px] font-black uppercase tracking-widest text-muted">
          Suggested destinations — best to worst
        </span>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={toggleHideFull}
            title="Hide rows with no free capacity"
            className={`px-2.5 py-2 rounded-xl border text-[11px] font-bold uppercase tracking-wider transition-colors ${
              hideFull
                ? 'bg-accent/10 border-accent/30 text-accent'
                : 'bg-card border-subtle text-muted hover:border-accent/40'
            }`}
          >
            Hide full
          </button>
          <HiddenRowsPicker availableRows={availableRows} api={hiddenRowsApi} />
        </div>
      </div>

      <div className="flex flex-col gap-2">
        {displayed.map((s) => (
          <button
            key={s.location}
            disabled={!enabled}
            onClick={() => onPick(s.location)}
            className={`w-full bg-card border rounded-2xl p-3 text-left transition-colors ${
              enabled
                ? 'border-subtle hover:border-accent/40 cursor-pointer'
                : 'border-subtle/50 opacity-60 cursor-not-allowed'
            }`}
          >
            <div className="flex items-start gap-3">
              <div
                className={`flex flex-col items-center justify-center min-w-[52px] px-2 py-1 rounded-lg border ${scoreColor(s.score)}`}
              >
                <span className="text-xl font-black leading-none">{s.score}</span>
                <span className="text-[9px] uppercase tracking-widest opacity-80">score</span>
              </div>

              <div className="flex-1 min-w-0">
                <div className="flex items-baseline gap-2 flex-wrap">
                  <span className="font-bold text-base text-content">{s.location}</span>
                  <span className="text-[11px] text-muted">
                    {s.free_units}/{s.max_capacity} free
                  </span>
                  {s.has_same_sku && (
                    <span className="text-[10px] font-bold uppercase tracking-widest px-1.5 py-0.5 rounded border bg-emerald-500/10 text-emerald-400 border-emerald-500/30">
                      Already has {s.same_sku_qty}
                    </span>
                  )}
                </div>

                {s.reasons.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-1.5">
                    {s.reasons.map((r, i) => (
                      <span
                        key={i}
                        className="text-[10px] text-muted bg-surface/60 px-1.5 py-0.5 rounded border border-subtle/40"
                      >
                        {r}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </button>
        ))}
      </div>

      {hasMore && (
        <button
          type="button"
          onClick={() => setShowAll((v) => !v)}
          className="w-full mt-2 px-3 py-2 rounded-xl border border-subtle bg-card text-xs font-bold uppercase tracking-widest text-muted hover:border-accent/40 hover:text-content transition-colors"
        >
          {showAll ? `Show top ${TOP_PICKS}` : `Show all ${visible.length} rows`}
        </button>
      )}

      {!enabled && disabledHint && (
        <div className="text-[11px] text-muted mt-2 text-center">{disabledHint}</div>
      )}
    </div>
  );
};
