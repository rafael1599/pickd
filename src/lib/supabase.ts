import {
  createClient,
  navigatorLock,
  NavigatorLockAcquireTimeoutError,
} from '@supabase/supabase-js';
import type { Database } from '../integrations/supabase/types';

const env =
  (typeof import.meta !== 'undefined' && import.meta.env) ||
  (typeof process !== 'undefined' && process.env) ||
  {};
const supabaseUrl =
  env.VITE_SUPABASE_URL ||
  (typeof process !== 'undefined' && process.env.VITE_SUPABASE_URL) ||
  'http://127.0.0.1:54321';
const supabaseAnonKey =
  env.VITE_SUPABASE_ANON_KEY ||
  (typeof process !== 'undefined' && process.env.VITE_SUPABASE_ANON_KEY) ||
  'sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH';

/**
 * auth-js's default lock (`navigatorLock`, picked automatically whenever
 * `persistSession` + a browser with `navigator.locks` — both true here) asks
 * for it with NO timeout (every internal call is `_acquireLock(-1, …)`). A
 * mobile tab that goes to the background is frozen by the OS mid-lock, and
 * never releases it; the tab in front then waits on `getSession`/token
 * refresh forever — "se pausa hasta que cierre las otras ventanas" (Rafael,
 * 18 sep 2026). This wraps it with a bounded wait: if the lock doesn't come
 * through in 5s, run without it rather than hang. Cross-tab coordination
 * still works the rest of the time; the only cost is a rare double refresh
 * of the same token, which Supabase tolerates within its reuse window.
 */
const authLock: typeof navigatorLock = async (name, acquireTimeout, fn) => {
  let started = false;
  try {
    return await navigatorLock(name, acquireTimeout < 0 ? 10000 : acquireTimeout, () => {
      started = true;
      return fn();
    });
  } catch (e: unknown) {
    const err = e as { name?: string; message?: string } | null;
    const isAbortOrTimeout =
      e instanceof NavigatorLockAcquireTimeoutError ||
      err?.name === 'AbortError' ||
      String(err?.message || '')
        .toLowerCase()
        .includes('abort');

    if (!started && isAbortOrTimeout) {
      console.warn(
        `[authLock] Lock "${name}" acquire timed out or aborted — executing without lock`
      );
      return await fn();
    }
    throw e;
  }
};

/**
 * Unified Singleton Supabase client instance.
 * Includes optimized realtime and auth persistence settings to prevent instance duplication.
 */
export const supabase = createClient<Database>(supabaseUrl, supabaseAnonKey, {
  realtime: {
    params: {
      eventsPerSecond: 20, // Increased slightly for warehouse operations
    },
  },
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    lock: authLock,
  },
});
