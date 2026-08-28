// PLAN COMPLETED. Lists the plan's moves, executes them in order through
// the same mutations a hand move uses — updateItem for a letter change
// inside the row, moveItem across rows — revalidating each line first and
// skipping, never forcing, the ones that changed since they were planned.
// Lives in the Modal Manager, so it survives the zone unmounting mid-run.

import React, { useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import X from 'lucide-react/dist/esm/icons/x';
import Check from 'lucide-react/dist/esm/icons/check';
import Loader2 from 'lucide-react/dist/esm/icons/loader-2';
import { useAuth } from '../../../context/AuthContext';
import { useInventory } from '../../inventory/hooks/useInventoryData';
import { ZONES, type ZoneId } from '../engine';
import { describeMove, type PlanMove } from '../plan/slotPlan';
import { runMove, type Outcome } from './runMove';
import { fetchPlanMoves, finishPlan, markMove, slotPlanKey } from '../hooks/useSlotPlan';
import { WAREHOUSE_STOCK_KEY } from '../hooks/useWarehouseStock';
import { skuColorDark } from '../../../utils/skuColor';

interface Props {
  zoneId: ZoneId;
  planId: string;
  onClose: () => void;
}

export const SlotPlanExecuteSheet: React.FC<Props> = ({ zoneId, planId, onClose }) => {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const { updateItem, moveItem } = useInventory();
  const [moves, setMoves] = useState<PlanMove[] | null>(null);
  const [outcomes, setOutcomes] = useState<Record<number, Outcome>>({});
  const [running, setRunning] = useState<number | null>(null);
  const [finished, setFinished] = useState(false);

  useEffect(() => {
    fetchPlanMoves(planId)
      .then((m) => setMoves(m.filter((x) => x.status === 'planned')))
      .catch((e: Error) => toast.error(e.message));
  }, [planId]);

  const summary = useMemo(() => {
    const list = moves ?? [];
    return {
      count: list.length,
      units: list.reduce((s, m) => s + m.qty, 0),
      rows: new Set(list.flatMap((m) => [m.fromLocation, m.toLocation])).size,
    };
  }, [moves]);

  const execute = async () => {
    if (!moves || running !== null) return;
    let done = 0;
    let skipped = 0;
    let failed = 0;
    for (const m of moves) {
      setRunning(m.id);
      const outcome = await runMove(m, updateItem, moveItem, zoneId, 'Plan');
      setOutcomes((o) => ({ ...o, [m.id]: outcome }));
      try {
        await markMove(m.id, outcome.status, outcome.error);
      } catch (e) {
        toast.error((e as Error).message);
      }
      if (outcome.status === 'done') done++;
      else if (outcome.status === 'skipped') skipped++;
      else failed++;
      // Every move is a real change: let the map catch up as it goes.
      queryClient.invalidateQueries({ queryKey: WAREHOUSE_STOCK_KEY });
    }
    setRunning(null);
    try {
      await finishPlan(planId, user?.id ?? null);
    } catch (e) {
      toast.error((e as Error).message);
    }
    setFinished(true);
    queryClient.invalidateQueries({ queryKey: slotPlanKey(zoneId) });
    queryClient.invalidateQueries({ queryKey: ['inventory'] });
    toast.success(
      `${done} of ${moves.length} moved${skipped ? ` · ${skipped} skipped` : ''}${failed ? ` · ${failed} failed` : ''}`
    );
  };

  const busy = running !== null;

  return (
    <div
      className="fixed inset-0 z-[110] flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={busy ? undefined : onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Plan completed"
        className="w-full sm:max-w-lg max-h-[90vh] flex flex-col bg-surface border border-subtle rounded-t-2xl sm:rounded-2xl shadow-2xl pb-[env(safe-area-inset-bottom)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 pt-4 pb-3 border-b border-subtle flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <p className="font-mono text-[10px] tracking-[.14em] text-muted">
              {ZONES[zoneId].name} · PLAN
            </p>
            <div className="flex flex-wrap items-baseline gap-x-2 mt-1 font-mono text-content">
              <span className="text-2xl font-extrabold tabular-nums">{summary.count}</span>
              <span className="text-xs text-muted">moves</span>
              <span className="text-2xl font-extrabold tabular-nums">{summary.units}</span>
              <span className="text-xs text-muted">u</span>
              <span className="text-2xl font-extrabold tabular-nums">{summary.rows}</span>
              <span className="text-xs text-muted">rows</span>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="p-2 rounded-lg text-muted hover:text-content disabled:opacity-40"
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </div>

        <ol className="flex-1 overflow-y-auto px-5 py-3 flex flex-col gap-1.5">
          {moves === null && (
            <li className="flex items-center justify-center py-8 text-muted">
              <Loader2 className="animate-spin w-5 h-5 opacity-40" />
            </li>
          )}
          {moves?.length === 0 && (
            <li className="text-center text-muted text-sm py-8">Nothing planned.</li>
          )}
          {moves?.map((m) => {
            const tone = skuColorDark(m.sku);
            const o = outcomes[m.id];
            return (
              <li key={m.id} className="flex items-center gap-2 font-mono text-[11px] text-content">
                <span
                  className="px-1.5 py-0.5 rounded font-bold text-white whitespace-nowrap"
                  style={{ background: tone.bg, border: `1px solid ${tone.border}` }}
                >
                  {m.sku}
                </span>
                <span className="tabular-nums text-muted whitespace-nowrap">{m.qty}u</span>
                <span className="min-w-0 truncate">{describeMove(m)}</span>
                <span className="ml-auto shrink-0">
                  {running === m.id ? (
                    <Loader2 className="animate-spin w-3.5 h-3.5 text-muted" />
                  ) : o?.status === 'done' ? (
                    <Check size={14} className="text-accent" />
                  ) : o ? (
                    <span className="text-amber-400 whitespace-nowrap" title={o.error ?? ''}>
                      {o.status} · {o.error}
                    </span>
                  ) : (
                    <span className="text-muted/60">{m.kind}</span>
                  )}
                </span>
              </li>
            );
          })}
        </ol>

        <div className="px-5 py-4 border-t border-subtle flex items-center justify-end gap-2">
          {!finished ? (
            <>
              <button
                type="button"
                onClick={onClose}
                disabled={busy}
                className="px-4 py-2 rounded-lg border border-subtle bg-card font-mono text-[11px] tracking-[.1em] font-bold text-muted hover:text-content disabled:opacity-40"
              >
                NOT YET
              </button>
              <button
                type="button"
                onClick={execute}
                disabled={busy || !moves || moves.length === 0}
                className="px-4 py-2 rounded-lg bg-accent text-black font-mono text-[11px] tracking-[.1em] font-bold disabled:opacity-40"
              >
                {busy ? 'MOVING…' : 'EXECUTE'}
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-lg bg-accent text-black font-mono text-[11px] tracking-[.1em] font-bold"
            >
              DONE
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
