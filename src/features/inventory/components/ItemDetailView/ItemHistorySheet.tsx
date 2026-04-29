import React, { useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useQuery } from '@tanstack/react-query';
import X from 'lucide-react/dist/esm/icons/x';
import Clock from 'lucide-react/dist/esm/icons/clock';
import Plus from 'lucide-react/dist/esm/icons/plus';
import Minus from 'lucide-react/dist/esm/icons/minus';
import Trash2 from 'lucide-react/dist/esm/icons/trash-2';
import MoveIcon from 'lucide-react/dist/esm/icons/move';
import ArrowRight from 'lucide-react/dist/esm/icons/arrow-right';
import Package from 'lucide-react/dist/esm/icons/package';
import Settings from 'lucide-react/dist/esm/icons/settings';
import Calendar from 'lucide-react/dist/esm/icons/calendar';
import { useScrollLock } from '../../../../hooks/useScrollLock';
import { supabase } from '../../../../lib/supabase';
import type { InventoryLog, LogActionTypeValue } from '../../../../schemas/log.schema';
import { getUserColor } from '../../../../utils/userUtils';
import { moveDeltaUnits } from '../../utils/inventoryLogShape';

interface DistributionSnapshot {
  type?: string;
  change?: string;
  count?: number;
  units_each?: number;
}

interface ItemHistorySheetProps {
  isOpen: boolean;
  onClose: () => void;
  sku: string;
}

const getActionInfo = (type: LogActionTypeValue, log: InventoryLog) => {
  switch (type) {
    case 'MOVE':
      return {
        icon: <MoveIcon size={12} />,
        color: 'text-blue-500',
        bg: 'bg-blue-500/10',
        label: 'Relocate',
      };
    case 'ADD':
      return {
        icon: <Plus size={12} />,
        color: 'text-green-500',
        bg: 'bg-green-500/10',
        label: 'Restock',
      };
    case 'DEDUCT': {
      const label = log.order_number
        ? `ORDER #${log.order_number}`
        : log.list_id
          ? `ORDER #${log.list_id.slice(-6).toUpperCase()}`
          : 'Manual Pick';
      return { icon: <Minus size={12} />, color: 'text-red-500', bg: 'bg-red-500/10', label };
    }
    case 'DELETE':
      return { icon: <Trash2 size={12} />, color: 'text-muted', bg: 'bg-surface', label: 'Remove' };
    case 'EDIT':
      return {
        icon: <Clock size={12} />,
        color: 'text-blue-500',
        bg: 'bg-blue-500/10',
        label: 'Update',
      };
    case 'PHYSICAL_DISTRIBUTION': {
      const snap = log.snapshot_before as DistributionSnapshot | null | undefined;
      const distLabel = snap?.type
        ? `${snap.change === 'removed' ? '- ' : '+ '}${snap.count} ${snap.type} \u00d7 ${snap.units_each}u`
        : 'Distribution';
      return {
        icon: <Package size={12} />,
        color: 'text-orange-500',
        bg: 'bg-orange-500/10',
        label: distLabel,
      };
    }
    case 'SYSTEM_RECONCILIATION':
      return {
        icon: <Settings size={12} />,
        color: 'text-purple-500',
        bg: 'bg-purple-500/10',
        label: 'System Sync',
      };
    default:
      return {
        icon: <Clock size={12} />,
        color: 'text-muted',
        bg: 'bg-surface',
        label: (type as string) || 'Update',
      };
  }
};

const getDisplayQty = (log: InventoryLog) => {
  if (log.action_type === 'EDIT') return log.new_quantity ?? log.quantity_change ?? 0;
  if (log.action_type === 'PHYSICAL_DISTRIBUTION') {
    const snap = log.snapshot_before as DistributionSnapshot | null | undefined;
    return snap?.count && snap?.units_each ? snap.count * snap.units_each : (log.new_quantity ?? 0);
  }
  if (log.action_type === 'MOVE') {
    return moveDeltaUnits(log) ?? 0;
  }
  return Math.abs(log.quantity_change || 0);
};

export const ItemHistorySheet: React.FC<ItemHistorySheetProps> = ({ isOpen, onClose, sku }) => {
  const { data: logs, isLoading } = useQuery({
    queryKey: ['inventory_logs', 'item', sku],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('inventory_logs')
        .select('*')
        .eq('sku', sku)
        .order('created_at', { ascending: false })
        .limit(50);

      if (error) throw error;
      return (data || []) as unknown as InventoryLog[];
    },
    enabled: isOpen && !!sku,
    staleTime: 1000 * 15,
  });

  const groupedLogs = useMemo(() => {
    if (!logs) return {};
    const groups: Record<string, InventoryLog[]> = {};
    const today = new Date();
    const yesterday = new Date();
    yesterday.setDate(today.getDate() - 1);

    logs.forEach((log) => {
      const date = new Date(log.created_at);
      let dateLabel: string;
      if (date.toDateString() === today.toDateString()) dateLabel = 'Today';
      else if (date.toDateString() === yesterday.toDateString()) dateLabel = 'Yesterday';
      else
        dateLabel = date.toLocaleDateString(undefined, {
          weekday: 'long',
          month: 'short',
          day: 'numeric',
        });

      if (!groups[dateLabel]) groups[dateLabel] = [];
      groups[dateLabel].push(log);
    });
    return groups;
  }, [logs]);

  // Back button / scroll lock handled by useScrollLock
  useScrollLock(isOpen, onClose);

  if (!isOpen) return null;

  return createPortal(
    <div className="fixed inset-0 z-[75] flex flex-col justify-end">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-main/60 animate-in fade-in duration-200"
        onClick={onClose}
      />

      {/* Sheet */}
      <div className="relative bg-surface border-t border-subtle rounded-t-3xl max-h-[85vh] overflow-hidden flex flex-col animate-in slide-in-from-bottom duration-300">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-subtle shrink-0">
          <div>
            <h3 className="text-sm font-black uppercase tracking-tight text-content">
              Activity Log
            </h3>
            <p className="text-[10px] font-bold text-muted uppercase tracking-wider mt-0.5">
              {sku}
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-muted hover:text-content transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        {/* Content */}
        <div className="overflow-y-auto flex-1 p-4">
          {isLoading ? (
            <div className="flex items-center justify-center py-16">
              <div className="w-6 h-6 border-2 border-accent border-t-transparent rounded-full animate-spin" />
            </div>
          ) : !logs || logs.length === 0 ? (
            <div className="text-center py-16">
              <Clock className="mx-auto mb-3 opacity-10" size={36} />
              <p className="text-[10px] font-black uppercase tracking-widest text-muted">
                No activity recorded
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {Object.entries(groupedLogs).map(([date, items]) => (
                <div key={date}>
                  <div className="flex items-center gap-2 mb-3 sticky top-0 bg-surface/90 backdrop-blur-sm py-2 -mx-1 px-1 z-10">
                    <Calendar size={10} className="text-accent" />
                    <span className="text-[9px] font-black uppercase tracking-widest text-muted">
                      {date}
                    </span>
                  </div>

                  <div className="space-y-2">
                    {items.map((log) => {
                      const info = getActionInfo(log.action_type, log);
                      return (
                        <div
                          key={log.id}
                          className={`p-3 rounded-xl border ${
                            log.is_reversed
                              ? 'bg-main/40 border-subtle opacity-40 grayscale'
                              : 'bg-card border-subtle'
                          }`}
                        >
                          {/* Top row: icon + label + time + user */}
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <div className={`p-1.5 rounded-lg ${info.bg} ${info.color}`}>
                                {info.icon}
                              </div>
                              <span
                                className={`text-[9px] font-black px-1.5 py-0.5 ${info.bg} ${info.color} border border-current/20`}
                              >
                                {info.label}
                              </span>
                              {log.is_reversed && (
                                <span className="text-[7px] font-black uppercase text-muted bg-main px-1.5 py-0.5 border border-subtle rounded-full">
                                  Reversed
                                </span>
                              )}
                            </div>
                            <div className="text-right">
                              <span className="text-lg font-black leading-none text-content">
                                {getDisplayQty(log)}
                              </span>
                            </div>
                          </div>

                          {/* Location info */}
                          <div className="mt-2 flex items-center gap-2">
                            {log.action_type === 'MOVE' ? (
                              <div className="flex items-center gap-1.5 flex-1 text-[10px]">
                                <span className="font-bold text-muted">{log.from_location}</span>
                                <ArrowRight size={10} className="text-muted/40" />
                                <span className="font-black text-accent">{log.to_location}</span>
                              </div>
                            ) : (
                              <span className="text-[10px] font-bold text-muted">
                                {log.from_location || log.to_location || ''}
                              </span>
                            )}
                          </div>

                          {/* Time + user */}
                          <div className="mt-1.5 flex items-center gap-1.5 text-[9px] text-muted">
                            <span className="font-bold">
                              {new Date(log.created_at).toLocaleTimeString([], {
                                hour: '2-digit',
                                minute: '2-digit',
                              })}
                            </span>
                            <span className="opacity-40">&bull;</span>
                            <span
                              style={{ color: getUserColor(log.performed_by) }}
                              className="font-black"
                            >
                              {log.performed_by || 'Unknown'}
                            </span>
                          </div>

                          {/* Stock level change */}
                          {log.prev_quantity !== null &&
                            log.new_quantity !== null &&
                            log.prev_quantity !== log.new_quantity && (
                              <div className="mt-1.5 text-[8px] font-black uppercase tracking-widest text-muted/40">
                                Stock: {log.prev_quantity} &rarr; {log.new_quantity}
                              </div>
                            )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
};
