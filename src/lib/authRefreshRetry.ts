/**
 * "JWT expired" recovery: force a token refresh and replay the call once.
 *
 * `withSupabaseRetry` deliberately treats an expired JWT as terminal —
 * replaying the *same* dead token just burns the backoff window. That's the
 * right call for a token the client already knows is dead. But PostgREST
 * also answers `PGRST301 / JWT expired` in two cases where the client
 * believes its session is perfectly healthy, and there the immediate logout
 * is a false positive:
 *
 *   1. **Clock skew.** supabase-js decides "is my token expired?" against
 *      `expires_at` and the *device* clock (with a ~10s margin). A warehouse
 *      tablet whose clock drifts a minute ahead of the auth server never
 *      triggers the built-in refresh in `getSession()` — it sends a token the
 *      server considers expired and is convinced it's fine. `getSession()`
 *      can never fix this; only an unconditional `refreshSession()` can.
 *   2. **Expiry between `fetch()` and arrival.** The auth header is stamped
 *      when the request is created, not when it lands. A token with seconds
 *      left on it, on a request that queues behind others (big payload, six
 *      busy connections, flaky warehouse wifi), arrives expired.
 *
 * Both are transient and both are fixed by the same move: refresh
 * unconditionally, then replay. Only if the *refresh* fails is the session
 * genuinely gone, and then we escalate to `auth-error-401` exactly like
 * before (AuthContext clears state and redirects to /login).
 *
 * **Replay safety:** an expired JWT is rejected by PostgREST *before* the
 * request reaches Postgres, so nothing ran — replaying is safe even for
 * non-idempotent RPCs like `register_container`. This helper retries on
 * nothing else, precisely to keep that guarantee. Compose it with
 * `withSupabaseRetry` when you also want network/5xx retries.
 */

import { supabase } from './supabase';
import { isAuthError, type SupabaseLikeResult } from './supabaseRetry';

function errorOf<R>(result: R): SupabaseLikeResult<unknown>['error'] {
  return (result as { error?: SupabaseLikeResult<unknown>['error'] } | undefined)?.error ?? null;
}

function escalate(label: string): void {
  console.warn(`[${label}] Session refresh failed — dispatching auth-error-401`);
  window.dispatchEvent(new CustomEvent('auth-error-401'));
}

/**
 * Run a Supabase call; if it comes back with an expired/invalid JWT, refresh
 * the session and run it exactly once more.
 *
 * The callback must build a fresh query each time it's invoked (supabase
 * builders are single-use thenables) — i.e. `() => supabase.rpc(...)`, not a
 * pre-built builder. Returns the same `{ data, error }` shape as the
 * underlying call, so callers don't change their destructuring.
 */
export async function withAuthRefreshRetry<R>(
  fn: () => PromiseLike<R>,
  opts: { label?: string } = {}
): Promise<R> {
  const label = opts.label ?? 'supabase';

  const first = await fn();
  const firstError = errorOf(first);
  if (!firstError || !isAuthError(firstError)) return first;

  console.warn(
    `[${label}] Expired JWT (${firstError.code ?? firstError.status ?? 'no code'}) — forcing refresh and replaying once`
  );

  let refreshed = false;
  try {
    const { data, error } = await supabase.auth.refreshSession();
    refreshed = !error && !!data.session;
  } catch {
    refreshed = false;
  }

  if (!refreshed) {
    escalate(label);
    return first;
  }

  const second = await fn();
  const secondError = errorOf(second);
  // Still unauthorized on a token minted seconds ago — the session really is
  // dead (revoked refresh token, user deleted). Escalate instead of looping.
  if (secondError && isAuthError(secondError)) escalate(label);

  return second;
}
