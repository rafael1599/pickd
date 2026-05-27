/**
 * Retry wrapper for Supabase calls that don't live inside React Query.
 *
 * Rationale: `query-client.ts` configures retry + exponential backoff for
 * useQuery/useMutation. But Pickd has ~10 hot paths that call
 * `supabase.from(...).select(...)` directly inside `useCallback` /
 * `useEffect` for legacy / architectural reasons (OrdersScreen.fetchOrders,
 * DoubleCheckView Add-On detection, usePickingNotes, usePickingSync
 * initial fetches). On flaky networks those calls fail once and the user
 * sees "Failed to load orders" with no retry — even though React Query
 * usage everywhere else recovers gracefully.
 *
 * Migrating each path to useQuery is a bigger refactor (local state +
 * optimistic update sites everywhere). This helper is the cheap path:
 * wrap the call in `withSupabaseRetry(() => supabase.from(...).select(...))`
 * and it inherits the same retry behavior we already trust from the
 * React Query config:
 *
 *   - Do NOT retry 4xx-class client errors (auth, permission, validation).
 *     Bouncing those just produces louder failures with the same outcome.
 *   - DO retry network / 5xx / "no internet" errors with exponential
 *     backoff capped at 30s, up to N attempts (default 4 = ~30s total).
 *
 * Returns the same shape as the underlying supabase call so callers
 * don't have to change destructuring.
 */

/**
 * Generic result shape that subsumes both `PostgrestSingleResponse<T>`
 * (used by `.single()`/`.maybeSingle()`) and `PostgrestResponse<T>` (used
 * by list queries) without taking a hard dep on supabase-js types. We
 * only read `.data` and `.error`; everything else (status, count,
 * statusText) is preserved untouched as the supabase response object
 * flows through.
 *
 * The error has optional `code`/`message`/`status` because supabase
 * errors include all three; we tolerate any subset.
 */
export type SupabaseLikeResult<T> = {
  data: T | null;
  error: { code?: string; message?: string; status?: number } | null;
} & Record<string, unknown>;

export interface SupabaseRetryOptions {
  /** Max retry attempts. Defaults to 4 (initial + 3 retries → ~14s worst case). */
  maxAttempts?: number;
  /** Label used in console.warn between attempts (for debugging). */
  label?: string;
}

const DEFAULT_MAX_ATTEMPTS = 4;
const BACKOFF_CAP_MS = 30_000;

/**
 * Decide whether an error from supabase is worth retrying. Mirrors the
 * conservative rule in `query-client.ts:retry` so behavior is
 * consistent across the app.
 *
 * Retryable: anything with no `status` (fetch failure → no response),
 *            5xx server errors, 408 timeout, 429 rate limit.
 * Not retryable: 4xx auth/permission/validation (status 400-499 except
 *                408/429), and "no rows" PGRST116.
 */
function isRetryable(error: SupabaseLikeResult<unknown>['error']): boolean {
  if (!error) return false;
  const status = (error as { status?: number }).status;
  const code = (error as { code?: string }).code;

  // PostgREST "row not found" is a deterministic logical outcome,
  // never a transient failure.
  if (code === 'PGRST116') return false;

  if (typeof status === 'number') {
    if (status === 408 || status === 429) return true;
    if (status >= 500) return true;
    if (status >= 400 && status < 500) return false;
  }

  // No status (network error / abort / "Failed to fetch") → retry.
  return true;
}

function backoffDelay(attemptIndex: number): number {
  return Math.min(1000 * 2 ** attemptIndex, BACKOFF_CAP_MS);
}

/**
 * Wrap a Supabase call so transient errors get retried. The callback
 * returns the supabase builder (which is PromiseLike); we await it
 * here. Type inference uses the awaited value's shape, so callers get
 * back the same `.data`/`.error` types as the raw query — `(await
 * supabase.from(...).select(...))` and `await withSupabaseRetry(() =>
 * supabase.from(...).select(...))` are interchangeable.
 *
 * Usage:
 *   const { data, error } = await withSupabaseRetry(
 *     () => supabase.from('picking_lists').select('*'),
 *     { label: 'OrdersScreen.fetchOrders' }
 *   );
 */
export async function withSupabaseRetry<R>(
  fn: () => PromiseLike<R>,
  opts: SupabaseRetryOptions = {}
): Promise<R> {
  const maxAttempts = opts.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const label = opts.label ?? 'supabase';

  // `lastResult` typed as R via the loop. We seed it via the first
  // attempt below so we never expose a fake "{ data: null, error: null }"
  // typed-as-R that wouldn't actually satisfy R's specific shape.
  let lastResult: R | undefined;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      lastResult = await fn();
    } catch (thrown) {
      // Promise rejected — synthesize a "network failure" shaped like R.
      // We can only fill the fields we know exist on SupabaseLikeResult.
      lastResult = {
        data: null,
        error: { message: thrown instanceof Error ? thrown.message : String(thrown) },
      } as unknown as R;
    }

    // R is generic — at runtime we know supabase returns `{ data, error }`
    // so we reach into the object reflectively without forcing every caller
    // to widen their types.
    const err = (lastResult as { error?: SupabaseLikeResult<unknown>['error'] } | undefined)?.error;
    if (!err || !isRetryable(err)) {
      return lastResult;
    }

    const isLast = attempt === maxAttempts - 1;
    if (isLast) break;

    const delay = backoffDelay(attempt);
    // Soft warn so we can see the retries during a real-world outage
    // without spamming the user with toasts.
    console.warn(
      `[${label}] attempt ${attempt + 1}/${maxAttempts} failed (${err.message ?? 'no message'}). Retrying in ${delay}ms.`
    );
    await new Promise((r) => setTimeout(r, delay));
  }

  // `lastResult` is set by the first iteration; unreachable to be undefined.
  return lastResult as R;
}
