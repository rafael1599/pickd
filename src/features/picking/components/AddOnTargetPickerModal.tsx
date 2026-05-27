import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import X from 'lucide-react/dist/esm/icons/x';
import Star from 'lucide-react/dist/esm/icons/star';
import Package from 'lucide-react/dist/esm/icons/package';

import { supabase } from '../../../lib/supabase';

/** Statuses we'll surface as eligible merge targets. */
const OPEN_STATUSES = [
  'active',
  'ready_to_double_check',
  'double_checking',
  'needs_correction',
] as const;

/** Completed orders also surface, capped to this lookback window so we don't
 *  flood the modal with months of history. */
const COMPLETED_LOOKBACK_HOURS = 24;

export interface AddOnTargetCandidate {
  id: string;
  order_number: string | null;
  status: string;
  customer_id: string | null;
  customer_name: string | null;
  item_count: number;
  /** Time the order last changed status (proxy for completion time when
   *  status is 'completed'). picking_lists has no dedicated completed_at. */
  updated_at: string | null;
  /** Singleton group_id (if any). The modal already filtered out genuinely-
   *  grouped rows (>=2 siblings); when this is non-null, it's a stale
   *  singleton that the click handler should dissolve as part of the combine. */
  stale_group_id: string | null;
}

interface AddOnTargetPickerModalProps {
  /** Source order's customer (used to highlight matches). */
  sourceCustomerId: string | null;
  sourceCustomerName: string | null;
  /** picking_lists.id of the source — never list it as a target. */
  sourceOrderId: string;
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
  updated_at: string | null;
  customer: { name: string | null } | null;
}

export const AddOnTargetPickerModal: React.FC<AddOnTargetPickerModalProps> = ({
  sourceCustomerId,
  sourceCustomerName,
  sourceOrderId,
  onClose,
  onPick,
}) => {
  const [loading, setLoading] = useState(true);
  const [candidates, setCandidates] = useState<AddOnTargetCandidate[]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      // picking_lists has no completed_at column — use updated_at as the
      // proxy for "when did this status last change". For a row in 'completed'
      // that's the moment it landed there.
      const SELECT_COLS =
        'id, order_number, status, customer_id, group_id, items, updated_at, customer:customers(name)';

      // Open orders — always eligible.
      const openP = supabase
        .from('picking_lists')
        .select(SELECT_COLS)
        .in('status', OPEN_STATUSES as unknown as string[])
        .neq('id', sourceOrderId)
        .order('created_at', { ascending: false })
        .limit(100);

      // Completed orders, scoped to the recent window so we don't flood the
      // modal with months of history.
      const completedP = supabase
        .from('picking_lists')
        .select(SELECT_COLS)
        .eq('status', 'completed')
        .gte('updated_at', new Date(Date.now() - COMPLETED_LOOKBACK_HOURS * 3600_000).toISOString())
        .neq('id', sourceOrderId)
        .order('updated_at', { ascending: false })
        .limit(100);

      const [openRes, completedRes] = await Promise.all([openP, completedP]);
      if (cancelled) return;

      if (openRes.error || completedRes.error) {
        console.error('AddOnTargetPicker fetch failed:', openRes.error ?? completedRes.error);
      }

      const openRows = (openRes.data ?? []) as unknown as RawRow[];
      const completedRows = (completedRes.data ?? []) as unknown as RawRow[];

      const all = [...openRows, ...completedRows];

      // Resolve which group_ids are "genuinely grouped" (>=2 active siblings).
      // Singleton groups (1 member, leftover from a previous flow) are treated
      // as if the order were ungrouped — we'll dissolve them on combine.
      const groupIds = Array.from(
        new Set(all.map((r) => r.group_id).filter((g): g is string => !!g))
      );
      let realGroups = new Set<string>();
      if (groupIds.length > 0) {
        const { data: counts } = await supabase
          .from('picking_lists')
          .select('group_id')
          .in('group_id', groupIds);
        const counter = new Map<string, number>();
        for (const row of counts ?? []) {
          const gid = (row as { group_id: string | null }).group_id;
          if (!gid) continue;
          counter.set(gid, (counter.get(gid) ?? 0) + 1);
        }
        realGroups = new Set([...counter.entries()].filter(([, n]) => n >= 2).map(([gid]) => gid));
      }

      // Deduplicate + drop genuinely-grouped rows.
      const seen = new Set<string>();
      const merged: AddOnTargetCandidate[] = [];
      for (const r of all) {
        if (seen.has(r.id)) continue;
        seen.add(r.id);
        if (r.group_id && realGroups.has(r.group_id)) continue;
        merged.push({
          id: r.id,
          order_number: r.order_number,
          status: r.status,
          customer_id: r.customer_id,
          customer_name: r.customer?.name ?? null,
          item_count: Array.isArray(r.items) ? r.items.length : 0,
          updated_at: r.updated_at,
          stale_group_id: r.group_id ?? null,
        });
      }
      setCandidates(merged);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [sourceOrderId]);

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

  const heading = 'Pick an order to combine with';
  const subhead = 'These items will be combined into a single delivery.';
  const emptyHeadline = 'No other orders to combine with';
  const otherSectionLabel = 'Other orders';

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
                Try again later — only open orders or those completed in the last 24h are listed.
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
  // Show "Xh ago" only for completed orders — for open ones the timestamp is
  // less meaningful and would just clutter the chip line.
  const ago = candidate.status === 'completed' ? relativeAgo(candidate.updated_at) : null;
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
