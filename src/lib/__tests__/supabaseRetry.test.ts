import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { withSupabaseRetry, type SupabaseLikeResult } from '../supabaseRetry';

// Tiny helper for tests: pin the result shape so .data / .error are typed.
type R = SupabaseLikeResult<unknown>;

describe('withSupabaseRetry', () => {
  // Fake timers so the exponential backoff doesn't actually wait
  // (the helper sleeps 1s/2s/4s/… between attempts).
  beforeEach(() => {
    vi.useFakeTimers();
    // Silence the soft warn so test output stays clean.
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  /** Helper: run the retry function and tick through every backoff. */
  async function runWithTicks<T>(p: Promise<T>): Promise<T> {
    // Drain pending timers in a loop because each retry schedules a new
    // setTimeout AFTER the previous awaited result resolves.
    for (let i = 0; i < 10; i++) {
      await vi.runAllTimersAsync();
    }
    return p;
  }

  it('returns immediately on success without retrying', async () => {
    const fn = vi.fn<() => Promise<R>>().mockResolvedValue({ data: { ok: true }, error: null });
    const result = await runWithTicks(withSupabaseRetry(fn));
    expect(fn).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ data: { ok: true }, error: null });
  });

  it('does NOT retry 4xx client errors (auth, permission, validation)', async () => {
    const fn = vi
      .fn<() => Promise<R>>()
      .mockResolvedValue({ data: null, error: { status: 403, message: 'forbidden' } });
    const result = await runWithTicks(withSupabaseRetry(fn));
    expect(fn).toHaveBeenCalledTimes(1);
    expect(result.error?.status).toBe(403);
  });

  it('does NOT retry PGRST116 "row not found"', async () => {
    const fn = vi
      .fn<() => Promise<R>>()
      .mockResolvedValue({ data: null, error: { code: 'PGRST116', message: 'no rows' } });
    const result = await runWithTicks(withSupabaseRetry(fn));
    expect(fn).toHaveBeenCalledTimes(1);
    expect(result.error?.code).toBe('PGRST116');
  });

  it('retries 5xx server errors and recovers on success', async () => {
    const fn = vi
      .fn<() => Promise<R>>()
      .mockResolvedValueOnce({ data: null, error: { status: 503, message: 'unavailable' } })
      .mockResolvedValueOnce({ data: null, error: { status: 502, message: 'bad gateway' } })
      .mockResolvedValueOnce({ data: 'ok', error: null });
    const result = await runWithTicks(withSupabaseRetry(fn));
    expect(fn).toHaveBeenCalledTimes(3);
    expect(result).toEqual({ data: 'ok', error: null });
  });

  it('retries network failures (no status) and surfaces the last error', async () => {
    const fn = vi
      .fn<() => Promise<R>>()
      .mockResolvedValue({ data: null, error: { message: 'Failed to fetch' } });
    const result = await runWithTicks(withSupabaseRetry(fn, { maxAttempts: 3 }));
    expect(fn).toHaveBeenCalledTimes(3);
    expect(result.error?.message).toBe('Failed to fetch');
  });

  it('treats thrown exceptions as retryable network failures', async () => {
    const fn = vi
      .fn<() => Promise<R>>()
      .mockRejectedValueOnce(new Error('connection reset'))
      .mockRejectedValueOnce(new Error('connection reset'))
      .mockResolvedValueOnce({ data: 'ok', error: null });
    const result = await runWithTicks(withSupabaseRetry(fn, { maxAttempts: 4 }));
    expect(fn).toHaveBeenCalledTimes(3);
    expect(result.data).toBe('ok');
  });

  it('retries 408 timeout and 429 rate limit', async () => {
    const fn408 = vi
      .fn<() => Promise<R>>()
      .mockResolvedValueOnce({ data: null, error: { status: 408, message: 'timeout' } })
      .mockResolvedValueOnce({ data: 'ok', error: null });
    expect((await runWithTicks(withSupabaseRetry(fn408))).data).toBe('ok');

    const fn429 = vi
      .fn<() => Promise<R>>()
      .mockResolvedValueOnce({ data: null, error: { status: 429, message: 'rate limited' } })
      .mockResolvedValueOnce({ data: 'ok', error: null });
    expect((await runWithTicks(withSupabaseRetry(fn429))).data).toBe('ok');
  });

  it('respects custom maxAttempts', async () => {
    const fn = vi
      .fn<() => Promise<R>>()
      .mockResolvedValue({ data: null, error: { message: 'timeout' } });
    await runWithTicks(withSupabaseRetry(fn, { maxAttempts: 2 }));
    expect(fn).toHaveBeenCalledTimes(2);
  });
});
