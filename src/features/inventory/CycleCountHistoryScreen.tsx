import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import ArrowLeft from 'lucide-react/dist/esm/icons/arrow-left';
import ChevronDown from 'lucide-react/dist/esm/icons/chevron-down';
import CheckCircle2 from 'lucide-react/dist/esm/icons/check-circle-2';
import AlertCircle from 'lucide-react/dist/esm/icons/alert-circle';
import Clock from 'lucide-react/dist/esm/icons/clock';
import { supabase } from '../../lib/supabase';

interface CycleCountSession {
  id: string;
  label: string | null;
  source: string | null;
  status: string;
  warehouse: string;
  total_skus: number;
  total_counted: number;
  total_discrepancies: number;
  created_at: string;
  completed_at: string | null;
  created_by_name?: string;
}

interface CycleCountItem {
  id: string;
  sku: string;
  location: string | null;
  expected_qty: number | null;
  counted_qty: number | null;
  variance: number | null;
  status: string;
  counted_at: string | null;
}

const statusColors: Record<string, { bg: string; text: string; label: string }> = {
  draft: { bg: 'bg-surface', text: 'text-muted', label: 'DRAFT' },
  in_progress: { bg: 'bg-blue-500/10', text: 'text-blue-400', label: 'IN PROGRESS' },
  pending_review: { bg: 'bg-amber-500/10', text: 'text-amber-400', label: 'PENDING REVIEW' },
  completed: { bg: 'bg-green-500/10', text: 'text-green-400', label: 'COMPLETED' },
  cancelled: { bg: 'bg-red-500/10', text: 'text-red-400', label: 'CANCELLED' },
};

const formatDate = (date: string) =>
  new Date(date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

export const CycleCountHistoryScreen = () => {
  const navigate = useNavigate();
  const [sessions, setSessions] = useState<CycleCountSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [expandedItems, setExpandedItems] = useState<CycleCountItem[]>([]);
  const [loadingItems, setLoadingItems] = useState(false);

  useEffect(() => {
    supabase
      .from('cycle_count_sessions')
      .select('*, profiles!cycle_count_sessions_created_by_fkey(full_name)')
      .order('created_at', { ascending: false })
      .limit(20)
      .then(({ data }) => {
        const mapped = (data ?? []).map((s) => {
          const joined = s as typeof s & { profiles: { full_name: string } | null };
          return {
            ...s,
            created_by_name: joined.profiles?.full_name ?? 'Unknown',
          };
        }) as unknown as CycleCountSession[];
        setSessions(mapped);
        setLoading(false);
      });
  }, []);

  const toggleExpand = async (sessionId: string) => {
    if (expandedId === sessionId) {
      setExpandedId(null);
      return;
    }
    setExpandedId(sessionId);
    setLoadingItems(true);
    const { data } = await (supabase as any)
      .from('cycle_count_items')
      .select('id, sku, location, expected_qty, counted_qty, variance, status, counted_at')
      .eq('session_id', sessionId)
      .order('sku');
    setExpandedItems((data || []) as unknown as CycleCountItem[]);
    setLoadingItems(false);
  };

  return (
    <div className="min-h-screen bg-main text-content">
      {/* Header */}
      <header className="sticky top-0 z-30 bg-main/95 backdrop-blur-md border-b border-subtle px-4 py-4 flex items-center gap-3">
        <button
          onClick={() => navigate(-1)}
          className="p-2 bg-surface border border-subtle rounded-xl text-muted hover:text-content active:scale-90 transition-all"
        >
          <ArrowLeft size={20} />
        </button>
        <div>
          <h1 className="text-2xl font-black uppercase tracking-tighter leading-none">
            Cycle Counts
          </h1>
          <p className="text-[10px] text-muted font-black uppercase tracking-widest">
            History & Reports
          </p>
        </div>
      </header>

      <div className="max-w-2xl mx-auto px-4 py-6 space-y-3 pb-32">
        {loading ? (
          <div className="text-center py-20">
            <div className="w-8 h-8 border-3 border-accent border-t-transparent rounded-full animate-spin mx-auto" />
          </div>
        ) : sessions.length === 0 ? (
          <div className="text-center py-20 border-2 border-dashed border-subtle rounded-3xl">
            <Clock className="mx-auto mb-3 opacity-20 text-muted" size={40} />
            <p className="text-xs font-black uppercase tracking-widest text-muted">
              No cycle counts yet
            </p>
          </div>
        ) : (
          sessions.map((session) => {
            const sc = statusColors[session.status] || statusColors.draft;
            const isExpanded = expandedId === session.id;

            return (
              <div
                key={session.id}
                className="bg-card border border-subtle rounded-2xl overflow-hidden"
              >
                {/* Session header */}
                <button
                  onClick={() => toggleExpand(session.id)}
                  className="w-full text-left p-4 flex items-center gap-3 active:bg-surface/50 transition-colors"
                >
                  <div className="flex-1 min-w-0">
                    <p className="font-black text-lg tracking-tight truncate">
                      {session.label || `Count ${formatDate(session.created_at)}`}
                    </p>
                    <div className="flex items-center gap-2 mt-1">
                      <span
                        className={`px-2 py-0.5 rounded-md text-[8px] font-black uppercase tracking-widest ${sc.bg} ${sc.text} border border-current/10`}
                      >
                        {sc.label}
                      </span>
                      <span className="text-[10px] text-muted font-bold">
                        {formatDate(session.created_at)}
                      </span>
                      <span className="text-[10px] text-muted/50 font-bold">
                        by {session.created_by_name}
                      </span>
                    </div>
                  </div>

                  {/* Summary chips */}
                  <div className="flex items-center gap-2 shrink-0">
                    <div className="text-center">
                      <p className="text-sm font-black">
                        {session.total_counted}/{session.total_skus}
                      </p>
                      <p className="text-[8px] text-muted font-black uppercase">Counted</p>
                    </div>
                    {session.total_discrepancies > 0 && (
                      <div className="text-center">
                        <p className="text-sm font-black text-red-400">
                          {session.total_discrepancies}
                        </p>
                        <p className="text-[8px] text-red-400/70 font-black uppercase">Diff</p>
                      </div>
                    )}
                    <ChevronDown
                      size={16}
                      className={`text-muted transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`}
                    />
                  </div>
                </button>

                {/* Expanded items */}
                {isExpanded && (
                  <div className="border-t border-subtle bg-surface/30">
                    {loadingItems ? (
                      <div className="p-4 text-center">
                        <div className="w-5 h-5 border-2 border-accent border-t-transparent rounded-full animate-spin mx-auto" />
                      </div>
                    ) : expandedItems.length === 0 ? (
                      <p className="p-4 text-center text-xs text-muted font-bold uppercase">
                        No items in this session
                      </p>
                    ) : (
                      <div className="divide-y divide-subtle/30">
                        {expandedItems.map((item) => (
                          <div
                            key={item.id}
                            className="px-4 py-2.5 flex items-center justify-between"
                          >
                            <div className="flex items-center gap-2 min-w-0">
                              {item.status === 'counted' || item.status === 'verified' ? (
                                item.variance === 0 ? (
                                  <CheckCircle2 size={14} className="text-green-500 shrink-0" />
                                ) : (
                                  <AlertCircle size={14} className="text-red-400 shrink-0" />
                                )
                              ) : (
                                <div className="w-3.5 h-3.5 rounded-full border-2 border-subtle shrink-0" />
                              )}
                              <div className="min-w-0">
                                <p className="font-mono font-bold text-xs truncate">{item.sku}</p>
                                {item.location && (
                                  <p className="text-[9px] text-muted font-bold">{item.location}</p>
                                )}
                              </div>
                            </div>
                            <div className="flex items-center gap-3 shrink-0 text-xs font-mono font-bold">
                              <span className="text-muted">{item.expected_qty ?? '?'}</span>
                              {item.counted_qty != null && (
                                <>
                                  <span className="text-muted/30">→</span>
                                  <span
                                    className={
                                      item.variance === 0
                                        ? 'text-green-500'
                                        : (item.variance ?? 0) > 0
                                          ? 'text-amber-400'
                                          : 'text-red-400'
                                    }
                                  >
                                    {item.counted_qty}
                                  </span>
                                  {item.variance !== 0 && item.variance != null && (
                                    <span
                                      className={`text-[9px] ${item.variance > 0 ? 'text-amber-400' : 'text-red-400'}`}
                                    >
                                      ({item.variance > 0 ? '+' : ''}
                                      {item.variance})
                                    </span>
                                  )}
                                </>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};

export default CycleCountHistoryScreen;
