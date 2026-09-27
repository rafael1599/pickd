import { persister } from '../lib/query-client';

/**
 * Checks if the reset epoch from the server requires a local data reset.
 */
export function isResetEpochNeeded(serverEpoch: number, localEpoch: number): boolean {
  return serverEpoch > localEpoch;
}

/**
 * Reads the last acknowledged reset epoch from localStorage.
 */
export function getStoredResetEpoch(): number {
  try {
    if (typeof localStorage === 'undefined') return 0;
    return Number(localStorage.getItem('pickd_reset_epoch') || 0);
  } catch {
    return 0;
  }
}

/**
 * Backs up Supabase authentication tokens from a Storage instance.
 * Preserves keys like `sb-*-auth-token` and `supabase.auth.token`.
 */
export function backupAuthTokens(storage: Storage): Array<[string, string]> {
  const backup: Array<[string, string]> = [];
  try {
    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i);
      if (!key) continue;
      // Preserve Supabase auth tokens so operators don't need to log in again
      if (
        (key.startsWith('sb-') && key.endsWith('-auth-token')) ||
        (key.includes('sb-') && key.includes('auth-token')) ||
        key === 'supabase.auth.token'
      ) {
        const val = storage.getItem(key);
        if (val !== null) {
          backup.push([key, val]);
        }
      }
    }
  } catch (e) {
    console.warn('[resetEpoch] Failed to read auth tokens from storage', e);
  }
  return backup;
}

export interface PerformResetOptions {
  reload?: boolean;
  storage?: Storage;
  persisterClear?: () => Promise<void>;
}

/**
 * Atomically wipes PickD local state (IndexedDB client cache, Cache Storage,
 * Service Workers, sessionStorage, localStorage) while strictly preserving
 * Supabase auth tokens, sets pickd_reset_epoch, and optionally reloads.
 */
export async function performAppReset(
  targetEpoch: number,
  options?: PerformResetOptions
): Promise<void> {
  // 1. IndexedDB persister
  try {
    if (options?.persisterClear) {
      await options.persisterClear();
    } else {
      await persister.removeClient();
    }
  } catch (e) {
    console.warn('[resetEpoch] Failed to remove IDB client cache', e);
  }

  // 2. Cache Storage
  if (typeof caches !== 'undefined') {
    try {
      const cacheNames = await caches.keys();
      await Promise.all(cacheNames.map((name) => caches.delete(name)));
    } catch (e) {
      console.warn('[resetEpoch] Failed to clear caches', e);
    }
  }

  // 3. Service Workers
  if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
    try {
      const registrations = await navigator.serviceWorker.getRegistrations();
      await Promise.all(registrations.map((r) => r.unregister()));
    } catch (e) {
      console.warn('[resetEpoch] Failed to unregister service workers', e);
    }
  }

  // 4. sessionStorage
  try {
    if (typeof sessionStorage !== 'undefined') {
      sessionStorage.clear();
    }
  } catch (e) {
    console.warn('[resetEpoch] Failed to clear sessionStorage', e);
  }

  // 5. localStorage with Supabase auth preservation
  const store = options?.storage ?? (typeof localStorage !== 'undefined' ? localStorage : null);
  if (store) {
    const authBackup = backupAuthTokens(store);
    try {
      store.clear();
    } catch (e) {
      console.warn('[resetEpoch] Failed to clear storage', e);
    }
    for (const [key, value] of authBackup) {
      try {
        store.setItem(key, value);
      } catch (e) {
        console.warn(`[resetEpoch] Failed to restore auth token ${key}`, e);
      }
    }
    try {
      store.setItem('pickd_reset_epoch', String(targetEpoch));
    } catch (e) {
      console.warn('[resetEpoch] Failed to set pickd_reset_epoch', e);
    }
  }

  // 6. Reload page if requested
  if (options?.reload !== false && typeof window !== 'undefined' && window.location?.reload) {
    window.location.reload();
  }
}
