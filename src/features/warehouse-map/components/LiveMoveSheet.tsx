// LIVE: the drop as a question. One or two moves (a swap is two), the units
// and the squares, MOVE or CANCEL. Confirmed, they run now through the same
// path a hand move uses, and the map catches up.

import React, { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import X from 'lucide-react/dist/esm/icons/x';
import Check from 'lucide-react/dist/esm/icons/check';
import Loader2 from 'lucide-react/dist/esm/icons/loader-2';
import { useInventory } from '../../inventory/hooks/useInventoryData';
import { ZONES, type ZoneId } from '../engine';
import { describeMove, type MoveDraft } from '../plan/slotPlan';
import { WAREHOUSE_STOCK_KEY } from '../hooks/useWarehouseStock';
import { skuColorDark } from '../../../utils/skuColor';
import { runMove, type Outcome } from './runMove';

interface Props {
  zoneId: ZoneId;
  drafts: MoveDraft[];
  rule: 'move' | 'swap' | 'join';
  onClose: () => void;
}

const RULE_WORD: Record<Props['rule'], string> = {
  move: 'Move',
  swap: 'Swap',
  join: 'Move in with the others',
};

export const LiveMoveSheet: React.FC<Props> = ({ zoneId, drafts, rule, onClose }) => {
  const queryClient = useQueryClient();
  const { updateItem, moveItem } = useInventory();
  const [running, setRunning] = useState<number | null>(null);
  const [outcomes, setOutcomes] = useState<Record<number, Outcome>>({});
  const [finished, setFinished] = useState(false);
  const busy = running !== null;

  const go = async () => {
    if (busy) return;
    let done = 0;
    for (let i = 0; i < drafts.length; i++) {
      setRunning(i);
      const o = await runMove(drafts[i], updateItem, moveItem, zoneId, 'Live');
      setOutcomes((prev) => ({ ...prev, [i]: o }));
      if (o.status === 'done') done++;
      queryClient.invalidateQueries({ queryKey: WAREHOUSE_STOCK_KEY });
    }
    setRunning(null);
    setFinished(true);
    queryClient.invalidateQueries({ queryKey: ['inventory'] });
    if (done === drafts.length) {
      toast.success(drafts.length === 1 ? `Moved ${drafts[0].sku}` : `Swapped — ${done} moves`);
      onClose();
    } else {
      toast.error(`${done} of ${drafts.length} moved`);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[110] flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={busy ? undefined : onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={RULE_WORD[rule]}
        className="w-full sm:max-w-md bg-surface border border-subtle rounded-t-2xl sm:rounded-2xl shadow-2xl pb-[env(safe-area-inset-bottom)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 pt-4 pb-3 border-b border-subtle flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <p className="font-mono text-[10px] tracking-[.14em] text-muted">
              {ZONES[zoneId].name} · LIVE
            </p>
            <p className="font-mono text-base font-extrabold text-content mt-1">
              {RULE_WORD[rule]}?
            </p>
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

        <ol className="px-5 py-3 flex flex-col gap-2">
          {drafts.map((d, i) => {
            const tone = skuColorDark(d.sku);
            const o = outcomes[i];
            return (
              <li key={i} className="flex items-center gap-2 font-mono text-[12px] text-content">
                <span
                  className="px-1.5 py-0.5 rounded font-bold text-white whitespace-nowrap"
                  style={{ background: tone.bg, border: `1px solid ${tone.border}` }}
                >
                  {d.sku}
                </span>
                <span className="tabular-nums text-muted whitespace-nowrap">{d.qty}u</span>
                <span className="min-w-0 truncate">{describeMove(d)}</span>
                <span className="ml-auto shrink-0">
                  {running === i ? (
                    <Loader2 className="animate-spin w-3.5 h-3.5 text-muted" />
                  ) : o?.status === 'done' ? (
                    <Check size={14} className="text-accent" />
                  ) : o ? (
                    <span className="text-amber-400 whitespace-nowrap">{o.error}</span>
                  ) : null}
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
                CANCEL
              </button>
              <button
                type="button"
                onClick={go}
                disabled={busy}
                className="px-4 py-2 rounded-lg bg-accent text-black font-mono text-[11px] tracking-[.1em] font-bold disabled:opacity-40"
              >
                {busy ? 'MOVING…' : 'MOVE'}
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-lg bg-accent text-black font-mono text-[11px] tracking-[.1em] font-bold"
            >
              CLOSE
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
