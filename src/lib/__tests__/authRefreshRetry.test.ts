import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { withAuthRefreshRetry } from '../authRefreshRetry';
import type { SupabaseLikeResult } from '../supabaseRetry';

const refreshSession = vi.fn();
vi.mock('../supabase', () => ({
  supabase: { auth: { refreshSession: () => refreshSession() } },
}));

type R = SupabaseLikeResult<unknown>;

const EXPIRED: R = { data: null, error: { code: 'PGRST301', message: 'JWT expired' } };
const OK: R = { data: { ok: true }, error: null };
const LIVE_SESSION = { data: { session: { access_token: 'fresh' } }, error: null };

describe('withAuthRefreshRetry', () => {
  let dispatched: string[];

  beforeEach(() => {
    dispatched = [];
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(window, 'dispatchEvent').mockImplementation((e: Event) => {
      dispatched.push(e.type);
      return true;
    });
    refreshSession.mockReset();
  });
  afterEach(() => vi.restoreAllMocks());

  it('passes a successful call straight through without refreshing', async () => {
    const fn = vi.fn<() => Promise<R>>().mockResolvedValue(OK);
    await expect(withAuthRefreshRetry(fn)).resolves.toEqual(OK);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(refreshSession).not.toHaveBeenCalled();
  });

  it('does not refresh on non-auth errors — a 400 is the caller’s problem', async () => {
    const failure: R = { data: null, error: { status: 400, message: 'bad request' } };
    const fn = vi.fn<() => Promise<R>>().mockResolvedValue(failure);
    await expect(withAuthRefreshRetry(fn)).resolves.toEqual(failure);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(refreshSession).not.toHaveBeenCalled();
  });

  it('refreshes and replays once on PGRST301, returning the retry result', async () => {
    const fn = vi.fn<() => Promise<R>>().mockResolvedValueOnce(EXPIRED).mockResolvedValueOnce(OK);
    refreshSession.mockResolvedValue(LIVE_SESSION);

    await expect(withAuthRefreshRetry(fn)).resolves.toEqual(OK);
    expect(refreshSession).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledTimes(2);
    // Recovered silently — the user must not be bounced to /login.
    expect(dispatched).not.toContain('auth-error-401');
  });

  it('treats a bare 401 (no code) as an expired JWT too', async () => {
    const unauthorized: R = { data: null, error: { status: 401, message: 'Unauthorized' } };
    const fn = vi
      .fn<() => Promise<R>>()
      .mockResolvedValueOnce(unauthorized)
      .mockResolvedValueOnce(OK);
    refreshSession.mockResolvedValue(LIVE_SESSION);

    await expect(withAuthRefreshRetry(fn)).resolves.toEqual(OK);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('escalates to auth-error-401 without replaying when the refresh fails', async () => {
    const fn = vi.fn<() => Promise<R>>().mockResolvedValue(EXPIRED);
    refreshSession.mockResolvedValue({ data: { session: null }, error: { message: 'revoked' } });

    await expect(withAuthRefreshRetry(fn)).resolves.toEqual(EXPIRED);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(dispatched).toContain('auth-error-401');
  });

  it('escalates when refreshSession throws rather than returning an error', async () => {
    const fn = vi.fn<() => Promise<R>>().mockResolvedValue(EXPIRED);
    refreshSession.mockRejectedValue(new Error('network down'));

    await expect(withAuthRefreshRetry(fn)).resolves.toEqual(EXPIRED);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(dispatched).toContain('auth-error-401');
  });

  it('escalates and stops after one replay if the fresh token is still rejected', async () => {
    const fn = vi.fn<() => Promise<R>>().mockResolvedValue(EXPIRED);
    refreshSession.mockResolvedValue(LIVE_SESSION);

    await expect(withAuthRefreshRetry(fn)).resolves.toEqual(EXPIRED);
    expect(fn).toHaveBeenCalledTimes(2);
    expect(refreshSession).toHaveBeenCalledTimes(1);
    expect(dispatched).toContain('auth-error-401');
  });
});
