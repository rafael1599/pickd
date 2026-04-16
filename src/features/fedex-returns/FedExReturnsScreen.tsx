import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import ArrowLeft from 'lucide-react/dist/esm/icons/arrow-left';
import Package from 'lucide-react/dist/esm/icons/package';
import { useFedExReturns, useFedExReturnsRealtime } from './hooks/useFedExReturns';
import { IntakeBar } from './components/IntakeBar';
import { StatusFilter } from './components/StatusFilter';
import { ReturnCard } from './components/ReturnCard';
import type { ReturnStatus } from './types';

export const FedExReturnsScreen: React.FC = () => {
  const navigate = useNavigate();
  const [filter, setFilter] = useState<ReturnStatus | 'all'>('all');

  useFedExReturnsRealtime();
  const { data: returns = [], isLoading } = useFedExReturns();

  const counts = useMemo(() => {
    return returns.reduce(
      (acc, r) => {
        acc[r.status] += 1;
        return acc;
      },
      { received: 0, processing: 0, resolved: 0 }
    );
  }, [returns]);

  const filtered = useMemo(() => {
    if (filter === 'all') return returns;
    return returns.filter((r) => r.status === filter);
  }, [returns, filter]);

  return (
    <div className="min-h-screen bg-main text-content">
      <header className="sticky top-0 z-10 bg-main/95 backdrop-blur-sm border-b border-subtle px-4 py-3">
        <div className="flex items-center gap-3 max-w-lg mx-auto">
          <button
            onClick={() => navigate('/')}
            className="p-1.5 text-muted hover:text-content"
            aria-label="Back"
          >
            <ArrowLeft size={20} />
          </button>
          <h1 className="text-lg font-bold">FedEx Returns</h1>
          {counts.received > 0 && (
            <span className="ml-auto bg-yellow-500/15 text-yellow-400 text-xs font-bold px-2 py-0.5 rounded-full border border-yellow-500/30">
              {counts.received} pending
            </span>
          )}
        </div>
      </header>

      <main className="max-w-lg mx-auto px-4 py-4">
        <IntakeBar />

        <div className="mb-3">
          <StatusFilter value={filter} onChange={setFilter} counts={counts} />
        </div>

        {isLoading && <div className="text-center text-muted py-8 text-sm">Loading returns...</div>}

        {!isLoading && filtered.length === 0 && (
          <div className="flex flex-col items-center justify-center py-12 text-muted">
            <Package size={32} className="mb-2" />
            <p className="text-sm">
              {filter === 'all' ? 'No returns yet' : `No ${filter} returns`}
            </p>
          </div>
        )}

        {!isLoading && filtered.length > 0 && (
          <div className="space-y-2">
            {filtered.map((ret) => (
              <ReturnCard
                key={ret.id}
                return={ret}
                onTap={() => navigate(`/fedex-returns/${ret.id}`)}
              />
            ))}
          </div>
        )}
      </main>
    </div>
  );
};
