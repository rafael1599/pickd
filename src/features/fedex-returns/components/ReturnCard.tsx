import Package from 'lucide-react/dist/esm/icons/package';
import type { FedExReturn } from '../types';

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

  return (
    <button
      onClick={onTap}
      className="w-full bg-card border border-subtle rounded-2xl p-3 flex items-center gap-3 text-left hover:border-accent/40 transition-colors"
    >
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
        <div className="font-bold text-content text-sm truncate">{returnItem.tracking_number}</div>
        <div className="text-xs text-muted mt-0.5">
          {timeAgo(returnItem.received_at)}
          {returnItem.received_by_name ? ` · ${returnItem.received_by_name}` : ''}
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
    </button>
  );
};
