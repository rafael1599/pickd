import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import X from 'lucide-react/dist/esm/icons/x';
import Star from 'lucide-react/dist/esm/icons/star';
import Search from 'lucide-react/dist/esm/icons/search';
import Package from 'lucide-react/dist/esm/icons/package';

import { supabase } from '../../../../lib/supabase';
import type { PickingList } from '../../hooks/useDoubleCheckList';

export interface MergeTargetCandidate {
  id: string;
  order_number: string | null;
  status: string;
  customer_id: string | null;
  customer_name: string | null;
  item_count: number;
  updated_at: string | null;
  group_id: string | null;
}

interface BoardMergeModalProps {
  sourceOrder: PickingList;
  onClose: () => void;
  onMerge: (target: MergeTargetCandidate) => Promise<void>;
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

export const BoardMergeModal: React.FC<BoardMergeModalProps> = ({
  sourceOrder,
  onClose,
  onMerge,
}) => {
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [candidates, setCandidates] = useState<MergeTargetCandidate[]>([]);
  const [isMerging, setIsMerging] = useState(false);

  const sourceOrderId = sourceOrder.id;
  const [sourceCustomerId, setSourceCustomerId] = useState<string | null>(null);
  const [sourceCustomerName, setSourceCustomerName] = useState<string | null>(
    sourceOrder.customer?.name ?? null
  );

  // Search/fetch candidates from Supabase
  useEffect(() => {
    let cancelled = false;
    const fetchCandidates = async () => {
      setLoading(true);
      try {
        let currentCustomerId = sourceCustomerId;
        let currentCustomerName = sourceCustomerName;

        if (currentCustomerId === null) {
          const { data: sourceData } = await supabase
            .from('picking_lists')
            .select('customer_id, customer:customers(name)')
            .eq('id', sourceOrderId)
            .single();
          if (sourceData) {
            const typedData = sourceData as { customer_id?: string; customer?: { name?: string } };
            currentCustomerId = typedData.customer_id ?? null;
            currentCustomerName = typedData.customer?.name ?? null;
            if (!cancelled) {
              setSourceCustomerId(currentCustomerId);
              setSourceCustomerName(currentCustomerName);
            }
          }
        }

        const SELECT_COLS =
          'id, order_number, status, customer_id, group_id, items, updated_at, customer:customers(name)';

        let rows: RawRow[] = [];

        if (searchQuery.trim().length > 0) {
          const query = searchQuery.trim();

          // 1. Search by order number
          const orderNumP = supabase
            .from('picking_lists')
            .select(SELECT_COLS)
            .ilike('order_number', `%${query}%`)
            .neq('id', sourceOrderId)
            .order('updated_at', { ascending: false })
            .limit(50);

          // 2. Search by customer name
          const customerIdsRes = await supabase
            .from('customers')
            .select('id')
            .ilike('name', `%${query}%`)
            .limit(10);

          const customerIds = (customerIdsRes.data ?? []).map((c) => c.id);

          let customerP = Promise.resolve({ data: [] as RawRow[] });
          if (customerIds.length > 0) {
            customerP = supabase
              .from('picking_lists')
              .select(SELECT_COLS)
              .in('customer_id', customerIds)
              .neq('id', sourceOrderId)
              .order('updated_at', { ascending: false })
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              .limit(50) as any;
          }

          const [orderNumRes, customerRes] = await Promise.all([orderNumP, customerP]);
          if (cancelled) return;

          const orderNumRows = (orderNumRes.data ?? []) as unknown as RawRow[];
          const customerRows = (customerRes.data ?? []) as unknown as RawRow[];
          rows = [...orderNumRows, ...customerRows];
        } else {
          // Default: Fetch open orders + completed/cancelled orders for the same customer
          const openP = supabase
            .from('picking_lists')
            .select(SELECT_COLS)
            .in('status', [
              'active',
              'ready_to_double_check',
              'double_checking',
              'needs_correction',
            ])
            .neq('id', sourceOrderId)
            .order('created_at', { ascending: false })
            .limit(50);

          let sameCustomerP = Promise.resolve({ data: [] as RawRow[] });
          if (currentCustomerId) {
            sameCustomerP = supabase
              .from('picking_lists')
              .select(SELECT_COLS)
              .eq('customer_id', currentCustomerId)
              .in('status', ['completed', 'cancelled'])
              .neq('id', sourceOrderId)
              .order('updated_at', { ascending: false })
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              .limit(30) as any;
          }

          const [openRes, sameCustomerRes] = await Promise.all([openP, sameCustomerP]);
          if (cancelled) return;

          rows = [...(openRes.data ?? []), ...(sameCustomerRes.data ?? [])] as unknown as RawRow[];
        }

        // Deduplicate
        const seen = new Set<string>();
        const mapped: MergeTargetCandidate[] = [];
        for (const r of rows) {
          if (seen.has(r.id)) continue;
          seen.add(r.id);
          mapped.push({
            id: r.id,
            order_number: r.order_number,
            status: r.status,
            customer_id: r.customer_id,
            customer_name: r.customer?.name ?? null,
            item_count: Array.isArray(r.items) ? r.items.length : 0,
            updated_at: r.updated_at,
            group_id: r.group_id ?? null,
          });
        }
        setCandidates(mapped);
      } catch (err) {
        console.error('Failed to fetch merge candidates:', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    // Debounce search queries slightly, run immediately for empty queries
    if (searchQuery.trim().length > 0) {
      const timer = setTimeout(fetchCandidates, 300);
      return () => {
        cancelled = true;
        clearTimeout(timer);
      };
    } else {
      fetchCandidates();
      return () => {
        cancelled = true;
      };
    }
  }, [sourceOrderId, searchQuery, sourceCustomerId, sourceCustomerName]);

  // Separate same customer suggestions from others
  const { sameCustomer, others } = useMemo(() => {
    if (!sourceCustomerId) return { sameCustomer: [], others: candidates };
    const same: MergeTargetCandidate[] = [];
    const rest: MergeTargetCandidate[] = [];
    for (const c of candidates) {
      if (c.customer_id && c.customer_id === sourceCustomerId) same.push(c);
      else rest.push(c);
    }
    return { sameCustomer: same, others: rest };
  }, [candidates, sourceCustomerId]);

  const handlePick = async (target: MergeTargetCandidate) => {
    setIsMerging(true);
    try {
      await onMerge(target);
      onClose();
    } catch (err) {
      console.error('Merge action failed:', err);
    } finally {
      setIsMerging(false);
    }
  };

  return createPortal(
    <div className="fixed inset-0 z-[250] flex items-center justify-center bg-main/60 backdrop-blur-md p-4 animate-in fade-in duration-200">
      <div className="bg-[#1a1a1a] border border-white/10 rounded-2xl p-5 w-full max-w-lg max-h-[85vh] flex flex-col shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between mb-4 shrink-0">
          <div>
            <h3 className="text-sm font-black text-sky-400 uppercase tracking-widest flex items-center gap-1.5">
              <span>Merge with another order</span>
            </h3>
            <p className="text-[10px] text-muted/70 mt-1">
              Selected orders will be merged into a single combined group.
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-muted hover:text-content transition-colors rounded-lg hover:bg-content/[0.05]"
            type="button"
            disabled={isMerging}
          >
            <X size={18} />
          </button>
        </div>

        {/* Search Bar */}
        <div className="relative shrink-0 mb-4">
          <Search size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted" />
          <input
            type="text"
            placeholder="Search by order # or customer..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            disabled={isMerging}
            className="w-full min-h-10 pl-10 pr-4 bg-surface border border-subtle rounded-xl text-xs placeholder:text-muted/60 text-content focus:outline-none focus:border-sky-500/50 focus:ring-1 focus:ring-sky-500/30 transition-all"
          />
        </div>

        {/* Candidate List */}
        <div className="overflow-y-auto flex-1 space-y-4 pr-1">
          {loading ? (
            <div className="flex items-center justify-center py-16 text-muted text-xs">
              <div className="w-4 h-4 border-2 border-sky-400 border-t-transparent rounded-full animate-spin mr-2" />
              Searching orders…
            </div>
          ) : isMerging ? (
            <div className="flex flex-col items-center justify-center py-16 text-muted text-xs gap-3">
              <div className="w-6 h-6 border-2 border-sky-400 border-t-transparent rounded-full animate-spin" />
              <span>Merging and reopening if necessary…</span>
            </div>
          ) : candidates.length === 0 ? (
            <div className="text-center py-12 border border-dashed border-white/5 rounded-xl bg-content/[0.01]">
              <Package className="mx-auto mb-3 opacity-20 text-muted" size={32} />
              <p className="text-[11px] font-bold text-muted/80 uppercase tracking-widest">
                No orders found
              </p>
              <p className="text-[10px] text-muted/50 mt-1">
                Try searching by exact order number or another customer.
              </p>
            </div>
          ) : (
            <>
              {/* Same Customer Suggestions */}
              {sameCustomer.length > 0 && (
                <section>
                  <div className="flex items-center gap-1.5 mb-2 px-1">
                    <Star size={10} className="text-emerald-400 fill-emerald-400" />
                    <span className="text-[9px] font-black text-emerald-400 uppercase tracking-widest">
                      Same Customer{sourceCustomerName ? ` — ${sourceCustomerName}` : ''}
                    </span>
                  </div>
                  <ul className="space-y-1.5">
                    {sameCustomer.map((c) => (
                      <li key={c.id}>
                        <CandidateRow candidate={c} highlight onPick={handlePick} />
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              {/* Other Candidate Lists */}
              {others.length > 0 && (
                <section>
                  <div className="flex items-center gap-1.5 mb-2 px-1 mt-1">
                    <span className="text-[9px] font-black text-muted/60 uppercase tracking-widest">
                      Other Active Orders
                    </span>
                  </div>
                  <ul className="space-y-1.5">
                    {others.map((c) => (
                      <li key={c.id}>
                        <CandidateRow candidate={c} highlight={false} onPick={handlePick} />
                      </li>
                    ))}
                  </ul>
                </section>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="mt-4 shrink-0 flex gap-2">
          <button
            onClick={onClose}
            className="flex-1 min-h-10 rounded-xl font-black uppercase tracking-widest text-[10px] bg-surface text-muted border border-subtle transition-all hover:bg-surface/80 active:scale-[0.97]"
            type="button"
            disabled={isMerging}
          >
            Cancel
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
};

const CandidateRow: React.FC<{
  candidate: MergeTargetCandidate;
  highlight: boolean;
  onPick: (c: MergeTargetCandidate) => void;
}> = ({ candidate, highlight, onPick }) => {
  const ago = relativeAgo(candidate.updated_at);
  const isPastOrder = candidate.status === 'completed' || candidate.status === 'cancelled';

  return (
    <button
      type="button"
      onClick={() => onPick(candidate)}
      className={`w-full text-left rounded-xl px-3 py-2.5 transition-all active:scale-[0.99] border flex items-center justify-between gap-3 ${
        highlight
          ? 'bg-emerald-500/5 border-emerald-500/20 hover:bg-emerald-500/10'
          : 'bg-surface border-subtle hover:bg-surface/80'
      }`}
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span
            className={`text-xs font-black tracking-tight ${highlight ? 'text-emerald-300' : 'text-content/85'}`}
          >
            #{candidate.order_number ?? '—'}
          </span>
          <StatusChip status={candidate.status} />
          {ago && <span className="text-[9px] font-bold text-muted/50">{ago}</span>}
          {candidate.group_id && (
            <span className="text-[8px] font-bold text-sky-400 bg-sky-500/10 border border-sky-500/20 px-1 py-0.5 rounded">
              Grouped
            </span>
          )}
        </div>
        {candidate.customer_name && (
          <div className="text-[10px] text-muted/70 truncate mt-0.5">{candidate.customer_name}</div>
        )}
      </div>
      <div className="text-right shrink-0">
        <div className="text-[10px] font-bold text-muted/60">
          {candidate.item_count} {candidate.item_count === 1 ? 'item' : 'items'}
        </div>
        {isPastOrder && (
          <div className="text-[8px] font-bold text-amber-500 uppercase tracking-wider mt-0.5">
            Reopen on merge
          </div>
        )}
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
              : status === 'cancelled'
                ? 'Cancelled'
                : status;

  let tone = 'text-muted/70 border-subtle';
  if (status === 'completed') {
    tone = 'text-blue-400/80 border-blue-400/20 bg-blue-500/5';
  } else if (status === 'cancelled') {
    tone = 'text-red-400/80 border-red-400/20 bg-red-500/5';
  } else if (status === 'needs_correction') {
    tone = 'text-amber-400/80 border-amber-400/20 bg-amber-500/5';
  }

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
