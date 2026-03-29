import { get, set, del } from 'idb-keyval';
import { QueryClient, MutationCache, QueryCache } from '@tanstack/react-query';
import { PersistedClient, Persister } from '@tanstack/react-query-persist-client';

/**
 * Cache Versioning - increment this to force-invalidate all client caches.
 */
import { registerMutationDefaults } from './mutationRegistry';

/** Shape of errors from Supabase/AppError for status/code extraction. */
interface ServiceError extends Error {
  status?: number;
  code?: string;
  originalError?: {
    status?: number;
    code?: string;
  };
}

const CACHE_VERSION = 'v1.2.0';
const BASE_CACHE_KEY = 'pickd-inventory-cache';
const VERSIONED_KEY = `${BASE_CACHE_KEY}-${CACHE_VERSION}`;

/**
 * Creates an IndexedDB persister using idb-keyval.
 * Includes versioning logic to prevent loading stale "zombie" data.
 */
export function createIDBPersister(idbValidKey: IDBValidKey = VERSIONED_KEY): Persister {
  return {
    persistClient: async (client: PersistedClient) => {
      await set(idbValidKey, client);
    },
    restoreClient: async () => {
      return await get<PersistedClient>(idbValidKey);
    },
    removeClient: async () => {
      await del(idbValidKey);
    },
  };
}

/**
 * Global QueryClient configuration.
 * Aggressive caching and offline-first policies for warehouse operations.
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Data is considered fresh for 5 minutes
      staleTime: 1000 * 60 * 5,
      // Keep unused data in cache for 7 days (crucial for offline)
      gcTime: 1000 * 60 * 60 * 24 * 7,
      // If no network, don't fail, return cached data
      networkMode: 'offlineFirst',
      // Retry configuration for network resilience
      retry: (_, error: ServiceError) => {
        // Do not retry for specific client error statuses
        const status = error?.status || error?.originalError?.status;
        const code = error?.code || error?.originalError?.code;

        // 401 (Unauthorized), 403 (Forbidden), 404 (Not Found)
        // PGRST301 is Supabase specific for expired/invalid JWT
        if (
          status === 401 ||
          status === 403 ||
          status === 404 ||
          code === 'PGRST301' ||
          code === '42501' // Supabase RLS error (Forbidden)
        ) {
          return false;
        }

        // For any other error (connection lost, timeout, etc), retry infinitely
        // TanStack Query will use the retryDelay for exponential backoff
        return true;
      },
      // Exponential backoff: 1s, 2s, 4s, 8s... max 30s
      retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 30000),
      // Disabled to reduce egress bandwidth — data stays fresh via mutations + realtime
      refetchOnWindowFocus: false,
      // Re-sync when network is recovered
      refetchOnReconnect: true,
    },
    mutations: {
      // Mutations stay PAUSED if there is no network
      networkMode: 'offlineFirst',
      // Retry critical operations if network fails
      retry: 3,
      // Exponential backoff for mutations too
      retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 30000),
      // Ensure mutation state survives as long as query state
      gcTime: 1000 * 60 * 60 * 24 * 7,
    },
  },
  queryCache: new QueryCache({
    onError: (error: ServiceError) => {
      const status = error?.status || error?.originalError?.status;
      const code = error?.code || error?.originalError?.code;
      if (status === 401 || code === 'PGRST301') {
        console.warn('Session Expired - Re-authenticate (Query)');
        window.dispatchEvent(new CustomEvent('auth-error-401'));
      }
    },
  }),
  mutationCache: new MutationCache({
    onMutate: (_variables, mutation) => {
      console.log(
        `[FORENSIC][MUTATION][GLOBAL_START] ${new Date().toISOString()} - Key: ${JSON.stringify(mutation.options.mutationKey)}`,
        {
          status: mutation.state.status,
          variables: mutation.state.variables,
        }
      );
    },
    onError: (error: ServiceError, _variables, _context, mutation) => {
      const status = error?.status || error?.originalError?.status;
      const code = error?.code || error?.originalError?.code;
      console.error(
        `[FORENSIC][MUTATION][GLOBAL_ERROR] ${new Date().toISOString()} - Key: ${JSON.stringify(mutation.options.mutationKey)}`,
        error
      );
      if (status === 401 || code === 'PGRST301') {
        console.warn('Session Expired - Re-authenticate (Mutation)');
        window.dispatchEvent(new CustomEvent('auth-error-401'));
      }
    },
    onSuccess: (_data, _variables, _context, mutation) => {
      console.log(
        `[FORENSIC][MUTATION][GLOBAL_SUCCESS] ${new Date().toISOString()} - Key: ${JSON.stringify(mutation.options.mutationKey)}`
      );
      // Selective invalidation: only refresh inventory data, not every cached query.
      // Realtime subscriptions handle cross-user sync for the rest.
      if (queryClient.isMutating() === 1) {
        console.log('[Queue] Last mutation succeeded, invalidating inventory queries...');
        queryClient.invalidateQueries({ queryKey: ['inventory'] });
      }
    },
  }),
});

// ── Register mutation defaults immediately on client creation ────────
// This ensures that hydrated mutations can always find their mutationFn.
registerMutationDefaults(queryClient);

// Expose to window for debugging and E2E testing
if (typeof window !== 'undefined') {
  (window as unknown as Record<string, typeof queryClient>).queryClient = queryClient;
}

export const persister = createIDBPersister();

/**
 * Cleanup utility: Removes corrupted mutations with invalid IDs from the queue.
 * Call this on app initialization to prevent accumulated corruption.
 */
export async function cleanupCorruptedMutations() {
  const mutations = queryClient.getMutationCache().getAll();
  let cleanedCount = 0;

  mutations.forEach((mutation) => {
    // Check if it's an inventory mutation
    if (
      Array.isArray(mutation.options.mutationKey) &&
      mutation.options.mutationKey[0] === 'inventory'
    ) {
      const mutationType = mutation.options.mutationKey[1];
      const vars = mutation.state.variables as Record<string, unknown> | undefined;
      let shouldRemove = false;
      let reason = '';

      // 1. Clean updateQuantity mutations
      if (mutationType === 'updateQuantity') {
        if (vars?.preservedItem) {
          const item = vars.preservedItem as Record<string, unknown>;
          const numericId = Number(item.id);

          if (!item.id || isNaN(numericId) || numericId <= 0) {
            shouldRemove = true;
            reason = `Invalid preservedItem.id: ${String(item.id)}`;
          }
        }
      }

      // 2. Clean trackLog mutations (avoid poisoned log queue)
      if (mutationType === 'trackLog') {
        if (mutation.state.status === 'error') {
          shouldRemove = true;
          reason = `Log mutation failed: ${((mutation.state.error as ServiceError)?.message || 'Unknown').substring(0, 50)}`;
        }
      }

      // 3. Zombie detection: Aged paused mutations or orphaned mutations
      const isPending = mutation.state.status === 'pending';
      const isPaused = mutation.state.isPaused === true;
      const submittedAt = mutation.state.submittedAt || 0;
      const age = submittedAt > 0 ? Date.now() - submittedAt : 0;

      if (isPending && isPaused) {
        // If the mutation is pending and paused for more than 5 minutes, it's likely a zombie
        // that survived a reload but failed to resume or lost its context.
        if (age > 5 * 60 * 1000) {
          shouldRemove = true;
          reason = `Zombie: Pending + Paused for over 5m (${Math.round(age / 1000 / 60)}m)`;
        }

        // If it has no mutationFn and no matching default, it's an orphan and can't execute.
        // Note: defaultOptions can be checked via queryClient.getMutationDefaults(key)
        const hasFn = !!mutation.options.mutationFn;
        const hasDefault = !!queryClient.getMutationDefaults(mutation.options.mutationKey);

        if (!hasFn && !hasDefault) {
          shouldRemove = true;
          reason = 'Orphan: No mutationFn and no default registered';
        }
      }

      // 4. Generic error cleanup for any inventory mutation that is stuck in error
      if (!shouldRemove && mutation.state.status === 'error') {
        const error = mutation.state.error as ServiceError;
        const errorMessage = error?.message || '';

        if (
          errorMessage.includes('NaN') ||
          errorMessage.includes('ID inválido') ||
          errorMessage.includes('MUTATION ERROR') ||
          errorMessage.includes('null value in column "id"') ||
          errorMessage.includes('Failed to fetch') ||
          errorMessage.includes('not unique') || // Error: function is not unique
          error?.code === '22P02' ||
          error?.code === '42725' || // Ambiguous function/parameter
          error?.code === 'PGRST202' // Auto-remove if RPC wasn't found (Zombie mutations)
        ) {
          shouldRemove = true;
          reason = `Recoverable/Schema error detected: ${errorMessage.substring(0, 50)}`;
        }
      }

      if (shouldRemove) {
        console.warn(
          `[CLEANUP] Removing corrupted mutation for SKU ${String(vars?.sku || 'unknown')}`,
          {
            mutationKey: mutation.options.mutationKey,
            reason,
            status: mutation.state.status,
            vars,
          }
        );
        queryClient.getMutationCache().remove(mutation);
        cleanedCount++;
      }
    }
  });

  if (cleanedCount > 0) {
    console.log(`[CLEANUP] Removed ${cleanedCount} corrupted mutation(s) from queue`);
  } else {
    console.log('[CLEANUP] No corrupted mutations found');
  }

  return cleanedCount;
}
