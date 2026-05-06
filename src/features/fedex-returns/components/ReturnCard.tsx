import { useState } from 'react';
import Package from 'lucide-react/dist/esm/icons/package';
import Printer from 'lucide-react/dist/esm/icons/printer';
import Play from 'lucide-react/dist/esm/icons/play';
import Pencil from 'lucide-react/dist/esm/icons/pencil';
import Loader2 from 'lucide-react/dist/esm/icons/loader-2';
import toast from 'react-hot-toast';

import type { FedExReturn } from '../types';
import { printReturnLabel } from '../utils/generateReturnLabel';
import { useUpdateFedExReturn } from '../hooks/useFedExReturns';
import { EditReturnSheet } from './EditReturnSheet';

interface ReturnCardProps {
  return: FedExReturn;
  onTap: () => void;
}

function timeAgo(dateStr: string | null): string {
  if (!dateStr) return '';
  const ms = Date.now() - new Date(dateStr).getTime();
  const min = Math.floor(ms / 60_000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const d = Math.floor(hr / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(dateStr).toLocaleDateString();
}

const STATUS_STYLES: Record<FedExReturn['status'], string> = {
  received: 'bg-yellow-500/15 text-yellow-400 border-yellow-500/30',
  processing: 'bg-blue-500/15 text-blue-400 border-blue-500/30',
  resolved: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
};

const STATUS_LABELS: Record<FedExReturn['status'], string> = {
  received: 'Received',
  processing: 'Processing',
  resolved: 'Resolved',
};

export const ReturnCard: React.FC<ReturnCardProps> = ({ return: returnItem, onTap }) => {
  const itemCount = returnItem.items?.length ?? 0;
  const [editOpen, setEditOpen] = useState(false);
  const [isPrinting, setIsPrinting] = useState(false);
  const update = useUpdateFedExReturn();

  const handlePrint = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (isPrinting) return;
    setIsPrinting(true);
    try {
      await printReturnLabel({
        trackingNumber: returnItem.tracking_number,
        receivedAt: returnItem.received_at,
        receivedByName: returnItem.received_by_name,
        notes: returnItem.notes,
        rma: returnItem.rma,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Print failed';
      toast.error(message);
    } finally {
      setIsPrinting(false);
    }
  };

  const handleProcess = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (returnItem.status !== 'received' || update.isPending) return;
    try {
      await update.mutateAsync({ id: returnItem.id, status: 'processing' });
      toast.success('Processing started');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to start processing';
      toast.error(message);
    }
  };

  const handleEdit = (e: React.MouseEvent) => {
    e.stopPropagation();
    setEditOpen(true);
  };

  const canProcess = returnItem.status === 'received';

  return (
    <>
      <div
        role="button"
        tabIndex={0}
        onClick={onTap}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onTap();
          }
        }}
        className="w-full bg-card border border-subtle rounded-2xl p-3 flex flex-col gap-3 text-left hover:border-accent/40 transition-colors cursor-pointer"
      >
        <div className="flex items-center gap-3">
          {returnItem.label_photo_url ? (
            <img
              src={returnItem.label_photo_url}
              alt="Return label"
              className="w-14 h-14 rounded-xl object-cover bg-surface flex-shrink-0"
            />
          ) : (
            <div className="w-14 h-14 rounded-xl bg-surface flex items-center justify-center flex-shrink-0">
              <Package size={24} className="text-muted" />
            </div>
          )}

          <div className="flex-1 min-w-0">
            <div className="font-bold text-content text-sm truncate">
              {returnItem.tracking_number}
            </div>
            <div className="text-xs text-muted mt-0.5">
              {timeAgo(returnItem.received_at)}
              {returnItem.received_by_name ? ` · ${returnItem.received_by_name}` : ''}
            </div>
            <div className="flex items-center gap-1 mt-1 flex-wrap">
              {returnItem.rma && (
                <span className="text-[9px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded border border-subtle text-muted/80 bg-main/40">
                  RMA {returnItem.rma}
                </span>
              )}
              {returnItem.is_misship && (
                <span className="text-[9px] font-bold uppercase tracking-widest px-1.5 py-0.5 rounded border border-amber-500/40 text-amber-300 bg-amber-500/10">
                  Misship
                </span>
              )}
            </div>
          </div>

          <div className="flex flex-col items-end gap-1 flex-shrink-0">
            <span
              className={`text-[10px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-full border ${STATUS_STYLES[returnItem.status]}`}
            >
              {STATUS_LABELS[returnItem.status]}
            </span>
            {itemCount > 0 && (
              <span className="text-[10px] text-muted">
                {itemCount} {itemCount === 1 ? 'item' : 'items'}
              </span>
            )}
          </div>
        </div>

        {/* Action row — Print, Process, Edit. Each stops propagation so the
            row above keeps acting as the navigate-to-detail trigger. */}
        <div className="flex items-center gap-2 pt-2 border-t border-subtle/60">
          <button
            type="button"
            onClick={handlePrint}
            disabled={isPrinting}
            title="Print label"
            className="flex-1 flex items-center justify-center gap-1.5 py-2 text-xs font-bold text-muted hover:text-content hover:bg-surface rounded-lg transition-colors disabled:opacity-40"
          >
            {isPrinting ? <Loader2 size={14} className="animate-spin" /> : <Printer size={14} />}
            Print
          </button>
          <button
            type="button"
            onClick={handleProcess}
            disabled={!canProcess || update.isPending}
            title={
              canProcess
                ? 'Mark as processing'
                : returnItem.status === 'processing'
                  ? 'Already processing'
                  : 'Resolved — nothing to process'
            }
            className="flex-1 flex items-center justify-center gap-1.5 py-2 text-xs font-bold text-muted hover:text-content hover:bg-surface rounded-lg transition-colors disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-muted"
          >
            {update.isPending ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
            Process
          </button>
          <button
            type="button"
            onClick={handleEdit}
            title="Edit RMA / Misship / Notes"
            className="flex-1 flex items-center justify-center gap-1.5 py-2 text-xs font-bold text-muted hover:text-content hover:bg-surface rounded-lg transition-colors"
          >
            <Pencil size={14} />
            Edit
          </button>
        </div>
      </div>

      {editOpen && <EditReturnSheet ret={returnItem} onClose={() => setEditOpen(false)} />}
    </>
  );
};
