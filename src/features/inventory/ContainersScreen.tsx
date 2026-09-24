import { useNavigate } from 'react-router-dom';
import ArrowLeft from 'lucide-react/dist/esm/icons/arrow-left';
import Loader2 from 'lucide-react/dist/esm/icons/loader-2';

import { useContainerHistory } from './hooks/useContainers';

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

/** El historial de containers registrados; cada uno abre su reporte contra Ludlow. */
export const ContainersScreen = () => {
  const navigate = useNavigate();
  const { data: containers, isLoading, error } = useContainerHistory();

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

        {!isLoading && !error && (containers ?? []).length === 0 && (
          <p className="py-12 text-center text-muted text-xs font-bold">
            No containers registered.
          </p>
        )}

        <ul className="flex flex-col gap-2">
          {(containers ?? []).map((c) => (
            <li key={`${c.warehouse}-${c.container}`}>
              <button
                onClick={() => navigate(`/containers/${encodeURIComponent(c.container)}`)}
                className="w-full text-left bg-card border border-subtle rounded-2xl p-3 shadow-xs hover:bg-hover active:scale-[0.99] transition-all"
              >
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-lg font-black font-mono text-content">{c.container}</span>
                  <span className="text-[10px] text-muted font-bold uppercase tracking-wider">
                    {formatMoment(c.firstRegisteredAt)}
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
                  {c.remainingUnits > 0 && (
                    <span className="text-amber-600 dark:text-amber-400">
                      {c.remainingUnits} still in container
                    </span>
                  )}
                  {c.intakes > 1 && <span>{c.intakes} intakes</span>}
                </div>
              </button>
            </li>
          ))}
        </ul>
      </main>
    </div>
  );
};
