import type { ReturnStatus } from '../types';

interface StatusFilterProps {
  value: ReturnStatus | 'all';
  onChange: (status: ReturnStatus | 'all') => void;
  counts: { received: number; processing: number; resolved: number };
}

const PILLS: Array<{ key: ReturnStatus | 'all'; label: string }> = [
  { key: 'all', label: 'All' },
  { key: 'received', label: 'Received' },
  { key: 'processing', label: 'Processing' },
  { key: 'resolved', label: 'Resolved' },
];

export const StatusFilter: React.FC<StatusFilterProps> = ({ value, onChange, counts }) => {
  const total = counts.received + counts.processing + counts.resolved;
  const countFor = (key: ReturnStatus | 'all'): number => {
    if (key === 'all') return total;
    return counts[key];
  };

  return (
    <div className="flex gap-2 overflow-x-auto pb-2 -mx-4 px-4 scrollbar-hide">
      {PILLS.map(({ key, label }) => {
        const active = value === key;
        const count = countFor(key);
        return (
          <button
            key={key}
            onClick={() => onChange(key)}
            className={`flex items-center gap-2 rounded-full px-4 py-2 text-[11px] font-bold uppercase tracking-widest whitespace-nowrap transition-colors ${
              active
                ? 'bg-accent text-white shadow-lg shadow-accent/20'
                : 'bg-surface text-muted border border-subtle hover:text-content'
            }`}
          >
            <span>{label}</span>
            <span
              className={`rounded-full px-2 py-0.5 text-[10px] ${
                active ? 'bg-white/20' : 'bg-card'
              }`}
            >
              {count}
            </span>
          </button>
        );
      })}
    </div>
  );
};
