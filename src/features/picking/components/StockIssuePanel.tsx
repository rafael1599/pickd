import React, { useState } from 'react';
import RefreshCw from 'lucide-react/dist/esm/icons/refresh-cw';
import Trash2 from 'lucide-react/dist/esm/icons/trash-2';
import PackagePlus from 'lucide-react/dist/esm/icons/package-plus';
import Loader2 from 'lucide-react/dist/esm/icons/loader-2';
import { ReasonPicker, type ReasonActionType } from './ReasonPicker';
import type { StockIssue } from '../utils/stockIssue';
import type { StockRow } from '../utils/stockSubstitute';

export type ActionableStockIssue = Exclude<StockIssue, { kind: 'ok' } | { kind: 'auto_swap' }>;

export interface StockIssuePanelProps {
  issue: ActionableStockIssue;
  busy: boolean;
  /** Diagnosis only — a viewer who cannot correct the order. */
  readOnly?: boolean;
  onTake: (qty: number, reason: string) => Promise<void>;
  onRemove: (reason: string) => Promise<void>;
  onSwap: (row: StockRow, qty: number, reason: string) => Promise<void>;
  /** Opens Edit Order straight on the Replace search for this SKU. */
  onReplace: () => void;
  /** Opens the same "Bike or Part" flow as a long-press on the card. */
  onRegister: () => void;
}

type Pending =
  | { type: 'take'; qty: number }
  | { type: 'remove' }
  | { type: 'swap'; row: StockRow; qty: number }
  | null;

const PRESELECT: Record<'take' | 'remove' | 'swap', { action: ReasonActionType; reason: string }> =
  {
    take: { action: 'adjust_qty', reason: 'Partial stock only' },
    remove: { action: 'remove', reason: 'Out of stock' },
    swap: { action: 'swap', reason: 'Out of stock — replacing' },
  };

/**
 * The panel under a LOW STOCK / UNREG card: what exactly was found, and the
 * actions that make sense for THAT case, on this line only. Every action goes
 * through the same correction path as Edit Order (a reason, a note, the swap /
 * qty / remove machinery); this is only a shorter way to reach it. Clicks are
 * stopped here so the card underneath does not toggle its check.
 */
export const StockIssuePanel: React.FC<StockIssuePanelProps> = ({
  issue,
  busy,
  readOnly = false,
  onTake,
  onRemove,
  onSwap,
  onReplace,
  onRegister,
}) => {
  const [pending, setPending] = useState<Pending>(null);
  const [reason, setReason] = useState('');

  const suggestion: StockRow | null =
    issue.sibling ??
    (issue.similar
      ? {
          sku: issue.similar.sku,
          location: issue.similar.location,
          warehouse: 'LUDLOW',
          quantity: issue.similar.quantity,
          item_name: issue.similar.item_name,
        }
      : null);
  const suggestionQty = suggestion ? Math.min(suggestion.quantity, issue.need) : 0;
  const isUnreg = issue.kind === 'unregistered';
  const tone = isUnreg ? 'red' : 'amber';

  const open = (next: Exclude<Pending, null>) => {
    setPending(next);
    setReason(PRESELECT[next.type].reason);
  };
  const close = () => {
    setPending(null);
    setReason('');
  };
  const confirm = async () => {
    if (!pending || !reason) return;
    if (pending.type === 'take') await onTake(pending.qty, reason);
    else if (pending.type === 'remove') await onRemove(reason);
    else await onSwap(pending.row, pending.qty, reason);
    close();
  };

  const btn =
    'min-h-10 px-3 rounded-xl font-black uppercase tracking-widest text-[10px] transition-all active:scale-[0.97] disabled:opacity-40 flex items-center justify-center gap-1.5';

  return (
    <div
      onPointerDown={(e) => e.stopPropagation()}
      onPointerUp={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      data-testid="stock-issue-panel"
      className={`-mt-1 mb-1 px-3 py-2.5 rounded-b-2xl border border-t-0 ${
        tone === 'red' ? 'bg-red-500/10 border-red-500/25' : 'bg-amber-500/10 border-amber-500/25'
      }`}
    >
      <p
        className={`text-[12px] font-black leading-snug ${tone === 'red' ? 'text-red-400' : 'text-amber-400'}`}
      >
        {issue.headline}
      </p>
      {issue.detail && <p className="text-[11px] text-muted leading-snug mt-0.5">{issue.detail}</p>}

      {!readOnly && pending === null && (
        <div className="flex flex-wrap items-center gap-2 mt-2">
          {issue.kind === 'partial' && (
            <button
              type="button"
              disabled={busy}
              onClick={() => open({ type: 'take', qty: issue.available })}
              className={`${btn} bg-amber-500 text-black`}
            >
              Take {issue.available}
            </button>
          )}
          {isUnreg && (
            <button
              type="button"
              disabled={busy}
              onClick={onRegister}
              className={`${btn} bg-emerald-500 text-black`}
            >
              <PackagePlus size={12} /> Register
            </button>
          )}
          {suggestion && suggestionQty > 0 && (
            <button
              type="button"
              disabled={busy}
              onClick={() => open({ type: 'swap', row: suggestion, qty: suggestionQty })}
              className={`${btn} bg-accent/15 text-accent border border-accent/30`}
            >
              <RefreshCw size={12} /> Use {suggestion.sku}
              {suggestionQty < issue.need ? ` (${suggestionQty} of ${issue.need})` : ''}
            </button>
          )}
          <button
            type="button"
            disabled={busy}
            onClick={onReplace}
            className={`${btn} bg-card text-content border border-subtle`}
          >
            <RefreshCw size={12} /> Replace
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => open({ type: 'remove' })}
            className={`${btn} bg-red-500/15 text-red-400 border border-red-500/30`}
          >
            <Trash2 size={12} /> Remove
          </button>
          {busy && <Loader2 size={14} className="animate-spin text-muted" />}
        </div>
      )}

      {!readOnly && pending !== null && (
        <div className="mt-2 pt-2 border-t border-subtle/60">
          <p className="text-[10px] font-black uppercase tracking-widest text-muted mb-1">
            {pending.type === 'take' && `Take ${pending.qty} of ${issue.need} — why?`}
            {pending.type === 'remove' && 'Remove this line — why?'}
            {pending.type === 'swap' && `Use ${pending.row.sku} (${pending.qty}) — why?`}
          </p>
          <ReasonPicker
            actionType={PRESELECT[pending.type].action}
            preselect={PRESELECT[pending.type].reason}
            selectedReason={reason}
            onReasonChange={setReason}
          />
          <div className="flex items-center gap-2 mt-2">
            <button
              type="button"
              disabled={busy || !reason}
              onClick={() => void confirm()}
              className={`${btn} flex-1 bg-accent text-black`}
            >
              {busy ? <Loader2 size={14} className="animate-spin" /> : 'Confirm'}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={close}
              className={`${btn} bg-card text-muted border border-subtle`}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
