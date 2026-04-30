import React from 'react';
import { useQuery } from '@tanstack/react-query';
import Clock from 'lucide-react/dist/esm/icons/clock';
import ArrowRight from 'lucide-react/dist/esm/icons/arrow-right';

import { supabase } from '../../../../lib/supabase';
import type { InventoryLog } from '../../../../schemas/log.schema';
import { getActionInfo, getDisplayQty } from './ItemHistorySheet';

interface InlineItemHistoryProps {
  sku: string;
  limit?: number;
  onSeeAll?: () => void;
}

const formatRelative = (iso: string): string => {
  const then = new Date(iso).getTime();
  const diffDays = Math.floor((Date.now() - then) / 86_400_000);
  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return `${diffDays}d ago`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)}w ago`;
  if (diffDays < 365) return `${Math.floor(diffDays / 30)}mo ago`;
  return `${Math.floor(diffDays / 365)}y ago`;
};

export const InlineItemHistory: React.FC<InlineItemHistoryProps> = ({
  sku,
  limit = 5,
  onSeeAll,
}) => {
  const { data: logs, isLoading } = useQuery({
    queryKey: ['inventory_logs', 'item-inline', sku, limit],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('inventory_logs')
        .select('*')
        .eq('sku', sku)
        .order('created_at', { ascending: false })
        .limit(limit);
      if (error) throw error;
      return (data || []) as unknown as InventoryLog[];
    },
    enabled: !!sku,
    staleTime: 30_000,
  });

  return (
    <div className="bg-card border-b border-subtle mt-4 mx-4 rounded-2xl overflow-hidden">
      <div className="px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Clock size={12} className="text-accent" />
          <span className="text-[11px] font-bold text-accent uppercase tracking-wider">
            Recent activity
          </span>
        </div>
        {onSeeAll && logs && logs.length > 0 && (
          <button
            type="button"
            onClick={onSeeAll}
            className="text-[10px] font-black uppercase tracking-widest text-muted hover:text-content transition-colors"
          >
            See all
          </button>
        )}
      </div>

      {isLoading ? (
        <div className="px-4 pb-4 flex items-center gap-2 text-[10px] text-muted">
          <div className="w-3 h-3 border-2 border-accent border-t-transparent rounded-full animate-spin" />
          Loading…
        </div>
      ) : !logs || logs.length === 0 ? (
        <div className="px-4 pb-4 text-[10px] font-bold uppercase tracking-widest text-muted/60">
          No activity recorded
        </div>
      ) : (
        <ul className="divide-y divide-subtle/60">
          {logs.map((log) => {
            const info = getActionInfo(log.action_type, log);
            return (
              <li
                key={log.id}
                className={`flex items-center gap-2 px-4 py-2 ${
                  log.is_reversed ? 'opacity-40' : ''
                }`}
              >
                <div className={`p-1 rounded-md ${info.bg} ${info.color} shrink-0`}>
                  {info.icon}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 text-[10px] font-bold text-content/80 truncate">
                    <span className={`${info.color} truncate`}>{info.label}</span>
                    {log.is_reversed && (
                      <span className="text-[7px] font-black uppercase text-muted bg-main px-1 py-0.5 border border-subtle rounded-full">
                        Reversed
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-1 text-[9px] text-muted truncate">
                    {log.action_type === 'MOVE' ? (
                      <>
                        <span className="font-bold">{log.from_location || '—'}</span>
                        <ArrowRight size={9} className="text-muted/40 shrink-0" />
                        <span className="font-black text-accent">{log.to_location || '—'}</span>
                      </>
                    ) : (
                      <span className="font-bold">
                        {log.from_location || log.to_location || ''}
                      </span>
                    )}
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <div className="text-sm font-black leading-none text-content">
                    {getDisplayQty(log)}
                  </div>
                  <div className="text-[8px] font-bold uppercase tracking-widest text-muted/60 mt-0.5">
                    {formatRelative(log.created_at)}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
};
