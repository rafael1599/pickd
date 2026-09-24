import { useNavigate, useSearchParams } from 'react-router-dom';
import ArrowLeft from 'lucide-react/dist/esm/icons/arrow-left';
import Loader2 from 'lucide-react/dist/esm/icons/loader-2';

import { useContainerHistory, type ContainerHistoryEntry } from './hooks/useContainers';

function formatMoment(iso: string): string {
  return new Date(iso).toLocaleString('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

type Tab = 'coming' | 'past';

/**
 * Los containers registrados, en dos pestañas. Un container se registra por
 * adelantado: **coming** es el que todavía no se ha descargado, **past** el que
 * ya llegó (el día en que salió por MOVE al menos la mitad). Cada uno abre su
 * reporte.
 */
export const ContainersScreen = () => {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const tab: Tab = params.get('tab') === 'past' ? 'past' : 'coming';
  const { data: containers, isLoading, error } = useContainerHistory();

  const all = containers ?? [];
  const coming = all.filter((c) => !c.arrivedAt);
  const past = all
    .filter((c) => c.arrivedAt)
    .sort((a, b) => (b.arrivedAt ?? '').localeCompare(a.arrivedAt ?? ''));
  const list = tab === 'coming' ? coming : past;

  const renderCard = (c: ContainerHistoryEntry) => (
    <li key={`${c.warehouse}-${c.container}`}>
      <button
        onClick={() => navigate(`/containers/${encodeURIComponent(c.container)}`)}
        className="w-full text-left bg-card border border-subtle rounded-2xl p-3 shadow-xs hover:bg-hover active:scale-[0.99] transition-all"
      >
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-lg font-black font-mono text-content">{c.container}</span>
          <span className="text-[10px] text-muted font-bold uppercase tracking-wider text-right">
            {c.arrivedAt
              ? `Arrived ${formatMoment(c.arrivedAt)}`
              : `Registered ${formatMoment(c.firstRegisteredAt)}`}
          </span>
        </div>
        <div className="flex flex-wrap gap-x-4 gap-y-1 mt-1 text-xs text-muted font-bold">
          <span>
            <span className="text-content font-black">{c.skus}</span> SKUs
          </span>
          <span>
            <span className="text-content font-black">{c.bikes}</span> bikes
          </span>
          {c.parts > 0 && (
            <span>
              <span className="text-content font-black">{c.parts}</span> parts
            </span>
          )}
          {c.arrivedAt && c.remainingUnits > 0 && (
            <span className="text-amber-600 dark:text-amber-400">
              {c.remainingUnits} still inside
            </span>
          )}
          {c.intakes > 1 && <span>{c.intakes} intakes</span>}
        </div>
      </button>
    </li>
  );

  return (
    <div className="min-h-screen bg-main text-content pb-20">
      <header className="sticky top-0 z-30 bg-surface border-b border-subtle px-4 py-3">
        <div className="max-w-3xl mx-auto flex items-center gap-3">
          <button
            onClick={() => navigate(-1)}
            aria-label="Go back"
            className="p-2 bg-surface border border-subtle rounded-xl text-muted hover:text-content active:scale-90 transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            <ArrowLeft size={18} />
          </button>
          <h1 className="text-lg font-black uppercase tracking-tight text-content">Containers</h1>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-3 sm:px-6 pt-4">
        {isLoading && (
          <div className="py-20 flex justify-center text-muted">
            <Loader2 className="animate-spin text-accent" size={32} />
          </div>
        )}

        {error && (
          <div className="p-4 bg-red-50 border border-red-200 text-red-700 rounded-2xl text-xs font-bold">
            Failed to load containers: {(error as Error).message}
          </div>
        )}

        {!isLoading && !error && all.length === 0 && (
          <p className="py-12 text-center text-muted text-xs font-bold">
            No containers registered.
          </p>
        )}

        <div className="flex gap-2 mb-4" role="tablist">
          {(
            [
              ['coming', 'Coming', coming.length],
              ['past', 'Past', past.length],
            ] as const
          ).map(([key, label, count]) => (
            <button
              key={key}
              role="tab"
              aria-selected={tab === key}
              onClick={() => setParams({ tab: key }, { replace: true })}
              className={`flex-1 px-3 py-2 rounded-xl text-xs font-black uppercase tracking-wider border transition-all ${
                tab === key
                  ? 'bg-accent text-white border-accent'
                  : 'bg-card text-muted border-subtle hover:text-content'
              }`}
            >
              {label} ({count})
            </button>
          ))}
        </div>

        {!isLoading && !error && all.length > 0 && list.length === 0 && (
          <p className="py-12 text-center text-muted text-xs font-bold">
            {tab === 'coming' ? 'No containers on the way.' : 'No containers have arrived yet.'}
          </p>
        )}

        <ul className="flex flex-col gap-2">{list.map(renderCard)}</ul>
      </main>
    </div>
  );
};
