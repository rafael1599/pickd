import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import X from 'lucide-react/dist/esm/icons/x';
import Star from 'lucide-react/dist/esm/icons/star';
import Package from 'lucide-react/dist/esm/icons/package';

import { supabase } from '../../../lib/supabase';

/** Open statuses — eligible as merge targets in any mode. */
const OPEN_STATUSES = [
  'active',
  'ready_to_double_check',
  'double_checking',
  'needs_correction',
] as const;

/** In 'combine-any' mode we also surface completed orders — but cap them to
 *  this many hours back so the list stays focused on operationally-relevant
 *  candidates. */
const COMPLETED_LOOKBACK_HOURS = 24;

export interface AddOnTargetCandidate {
  id: string;
  order_number: string | null;
  status: string;
  customer_id: string | null;
  customer_name: string | null;
  item_count: number;
  completed_at: string | null;
}

export type AddOnPickerMode =
  /** Legacy: from a completed order being reopened, list OPEN targets only. */
  | 'add-target'
  /** Option A: from an open order, list ANY other order (open + recent completed). */
  | 'combine-any';

interface AddOnTargetPickerModalProps {
  /** Source order's customer (used to highlight matches). */
  sourceCustomerId: string | null;
  sourceCustomerName: string | null;
  /** picking_lists.id of the source — never list it as a target. */
  sourceOrderId: string;
  /** Picker mode (default 'add-target'). */
  mode?: AddOnPickerMode;
  onClose: () => void;
  onPick: (target: AddOnTargetCandidate) => void;
}

interface RawRow {
  id: string;
  order_number: string | null;
  status: string;
  customer_id: string | null;
  group_id: string | null;
  items: unknown;
  completed_at: string | null;
  customer: { name: string | null } | null;
}

export const AddOnTargetPickerModal: React.FC<AddOnTargetPickerModalProps> = ({
  sourceCustomerId,
  sourceCustomerName,
  sourceOrderId,
  mode = 'add-target',
  onClose,
  onPick,
}) => {
  const [loading, setLoading] = useState(true);
  const [candidates, setCandidates] = useState<AddOnTargetCandidate[]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      // Open orders — always eligible in both modes.
      const openP = supabase
        .from('picking_lists')
        .select(
          'id, order_number, status, customer_id, group_id, items, completed_at, customer:customers(name)'
        )
        .in('status', OPEN_STATUSES as unknown as string[])
        .is('group_id', null)
        .neq('id', sourceOrderId)
        .order('created_at', { ascending: false })
        .limit(100);

      // Completed orders — only in 'combine-any' mode, scoped to the recent
      // window so we don't flood the modal with months of history.
      const completedP =
        mode === 'combine-any'
          ? supabase
              .from('picking_lists')
              .select(
                'id, order_number, status, customer_id, group_id, items, completed_at, customer:customers(name)'
              )
              .eq('status', 'completed')
              .gte(
                'completed_at',
                new Date(Date.now() - COMPLETED_LOOKBACK_HOURS * 3600_000).toISOString()
              )
              .neq('id', sourceOrderId)
              .order('completed_at', { ascending: false })
              .limit(100)
          : Promise.resolve({ data: [] as RawRow[], error: null });

      const [openRes, completedRes] = await Promise.all([openP, completedP]);
      if (cancelled) return;

      if (openRes.error || completedRes.error) {
        console.error('AddOnTargetPicker fetch failed:', openRes.error ?? completedRes.error);
      }

      const openRows = (openRes.data ?? []) as unknown as RawRow[];
      const completedRows = (completedRes.data ?? []) as unknown as RawRow[];

      const all = [...openRows, ...completedRows];
      // Deduplicate by id just in case (shouldn't happen — disjoint statuses).
      const seen = new Set<string>();
      const merged: AddOnTargetCandidate[] = [];
      for (const r of all) {
        if (seen.has(r.id)) continue;
        seen.add(r.id);
        merged.push({
          id: r.id,
          order_number: r.order_number,
          status: r.status,
          customer_id: r.customer_id,
          customer_name: r.customer?.name ?? null,
          item_count: Array.isArray(r.items) ? r.items.length : 0,
          completed_at: r.completed_at,
        });
      }
      setCandidates(merged);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [sourceOrderId, mode]);

  const { sameCustomer, others } = useMemo(() => {
    if (!sourceCustomerId) return { sameCustomer: [], others: candidates };
    const same: AddOnTargetCandidate[] = [];
    const rest: AddOnTargetCandidate[] = [];
    for (const c of candidates) {
      if (c.customer_id && c.customer_id === sourceCustomerId) same.push(c);
      else rest.push(c);
    }
    return { sameCustomer: same, others: rest };
  }, [candidates, sourceCustomerId]);

  const heading =
    mode === 'combine-any' ? 'Pick an order to combine with' : 'Pick an order to merge into';
  const subhead =
    mode === 'combine-any'
      ? 'These items will be combined into a single delivery.'
      : 'Add-on items will land in the order you pick.';
  const emptyHeadline =
    mode === 'combine-any' ? 'No other orders to combine with' : 'No open orders to merge into';
  const otherSectionLabel = mode === 'combine-any' ? 'Other orders' : 'Other open orders';

  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-main/60 backdrop-blur-md p-4">
      <div className="bg-[#1a1a1a] border border-white/10 rounded-2xl p-5 w-full max-w-md max-h-[85vh] flex flex-col">
        <div className="flex items-center justify-between mb-4 shrink-0">
          <div>
            <h3 className="text-sm font-black text-orange-400 uppercase tracking-widest">
              {heading}
            </h3>
            <p className="text-[10px] text-muted/70 mt-1">{subhead}</p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-muted hover:text-content transition-colors"
            type="button"
          >
            <X size={18} />
          </button>
        </div>

        <div className="overflow-y-auto flex-1 space-y-4">
          {loading ? (
            <div className="flex items-center justify-center py-12 text-muted text-xs">
              <div className="w-4 h-4 border-2 border-accent border-t-transparent rounded-full animate-spin mr-2" />
              Loading orders…
            </div>
          ) : candidates.length === 0 ? (
            <div className="text-center py-10">
              <Package className="mx-auto mb-3 opacity-20" size={32} />
              <p className="text-[11px] font-bold text-muted/80 uppercase tracking-widest">
                {emptyHeadline}
              </p>
              <p className="text-[10px] text-muted/50 mt-2">
                {mode === 'combine-any'
                  ? 'Try again later — only open orders or those completed in the last 24h are listed.'
                  : 'Import a new order first, then try again.'}
              </p>
            </div>
          ) : (
            <>
              {sameCustomer.length > 0 && (
                <section>
                  <div className="flex items-center gap-1.5 mb-2 px-1">
                    <Star size={10} className="text-emerald-400" />
                    <span className="text-[9px] font-black text-emerald-400 uppercase tracking-widest">
                      Same customer{sourceCustomerName ? ` — ${sourceCustomerName}` : ''}
                    </span>
                  </div>
                  <ul className="space-y-1.5">
                    {sameCustomer.map((c) => (
                      <li key={c.id}>
                        <CandidateButton candidate={c} highlight onPick={onPick} />
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              {others.length > 0 && (
                <section>
                  <div className="flex items-center gap-1.5 mb-2 px-1 mt-1">
                    <span className="text-[9px] font-black text-muted/60 uppercase tracking-widest">
                      {otherSectionLabel}
                    </span>
                  </div>
                  <ul className="space-y-1.5">
                    {others.map((c) => (
                      <li key={c.id}>
                        <CandidateButton candidate={c} highlight={false} onPick={onPick} />
                      </li>
                    ))}
                  </ul>
                </section>
              )}
            </>
          )}
        </div>

        <div className="mt-4 shrink-0">
          <button
            onClick={onClose}
            className="w-full min-h-11 rounded-xl font-black uppercase tracking-widest text-[10px] bg-surface text-muted border border-subtle transition-all hover:bg-surface/80 active:scale-[0.97]"
            type="button"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
};

const CandidateButton: React.FC<{
  candidate: AddOnTargetCandidate;
  highlight: boolean;
  onPick: (c: AddOnTargetCandidate) => void;
}> = ({ candidate, highlight, onPick }) => {
  const ago = relativeAgo(candidate.completed_at);
  return (
    <button
      type="button"
      onClick={() => onPick(candidate)}
      className={`w-full text-left rounded-xl px-3 py-2.5 transition-all active:scale-[0.99] border ${
        highlight
          ? 'bg-emerald-500/10 border-emerald-500/30 hover:bg-emerald-500/15'
          : 'bg-surface border-subtle hover:bg-surface/80'
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span
              className={`text-xs font-black tracking-tight ${highlight ? 'text-emerald-300' : 'text-content/85'}`}
            >
              #{candidate.order_number ?? '—'}
            </span>
            <StatusChip status={candidate.status} />
            {ago && <span className="text-[9px] font-bold text-muted/50">{ago}</span>}
          </div>
          {candidate.customer_name && (
            <div className="text-[10px] text-muted/70 truncate mt-0.5">
              {candidate.customer_name}
            </div>
          )}
        </div>
        <div className="text-[10px] font-bold text-muted/60 shrink-0">
          {candidate.item_count} {candidate.item_count === 1 ? 'item' : 'items'}
        </div>
      </div>
    </button>
  );
};

const StatusChip: React.FC<{ status: string }> = ({ status }) => {
  const label =
    status === 'ready_to_double_check'
      ? 'Ready'
      : status === 'double_checking'
        ? 'Checking'
        : status === 'needs_correction'
          ? 'Correction'
          : status === 'active'
            ? 'Active'
            : status === 'completed'
              ? 'Completed'
              : status;
  const tone =
    status === 'completed' ? 'text-blue-400/80 border-blue-400/30' : 'text-muted/70 border-subtle';
  return (
    <span
      className={`text-[8px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded border bg-main/40 ${tone}`}
    >
      {label}
    </span>
  );
};

const relativeAgo = (iso: string | null): string | null => {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return null;
  const mins = Math.floor((Date.now() - t) / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
};
