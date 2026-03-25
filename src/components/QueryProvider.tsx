import { ReactNode } from 'react';
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';
import { queryClient, persister } from '../lib/query-client';

interface QueryProviderProps {
  children: ReactNode;
}

/**
 * Enhanced Query Provider with IndexedDB persistence.
 * Ensures the app works offline and preserves cache across sessions.
 */
export function QueryProvider({ children }: QueryProviderProps) {
  return (
    <PersistQueryClientProvider
      client={queryClient}
      persistOptions={{
        persister,
        maxAge: 1000 * 60 * 60 * 24 * 7, // 7 days
        dehydrateOptions: {
          shouldDehydrateMutation: (mutation) => {
            // Persist mutations that are paused (offline)
            // OR still pending (in-flight during reload).
            return mutation.state.isPaused === true || mutation.state.status === 'pending';
          },
        },
      }}
      onSuccess={() => {
        const resumeMutations = () => {
          const mutationCache = queryClient.getMutationCache();
          const mutations = mutationCache.getAll();

          // DURABILITY FIX: mutations restored from IndexedDB that were in-flight
          // often have status="pending" but isPaused=false.
          // resumePausedMutations() ignores them. We must force-pause them to resume.
          mutations.forEach((m) => {
            if (
              m.state.status === 'pending' &&
              !(m.state as unknown as { isPaused: boolean }).isPaused
            ) {
              console.log(
                `[QueryProvider] Restoring in-flight mutation for resumption: ${JSON.stringify(m.options.mutationKey)}`
              );
              (m.state as unknown as { isPaused: boolean }).isPaused = true;
            }
          });

          queryClient.resumePausedMutations();
        };

        // 1. Initial attempt after hydration
        resumeMutations();

        // 2. Setup robust listener for future reconnects (Phase 4)
        window.addEventListener('online', resumeMutations);

        // Cleanup listener if provider unmounts (rare but good practice)
        return () => window.removeEventListener('online', resumeMutations);
      }}
    >
      {children}
      {/* Devtools will only be visible in development mode */}
      {import.meta.env.DEV && <ReactQueryDevtools initialIsOpen={false} />}
    </PersistQueryClientProvider>
  );
}
