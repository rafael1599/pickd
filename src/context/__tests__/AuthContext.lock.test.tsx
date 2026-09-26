/**
 * bug-046: supabase-js runs onAuthStateChange callbacks while it holds the auth
 * lock, and every query needs that lock to read the token. This mock keeps
 * that contract — a query waits until the callback has returned — so a
 * callback that awaits the profile deadlocks here exactly as it did in the
 * browser (7 s, then role 'staff').
 */
import { describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';

type Cb = (event: string, session: unknown) => unknown;

const h = vi.hoisted(() => {
  const state = { cb: null as Cb | null, release: () => {}, lock: Promise.resolve() };
  const session = { user: { id: 'u-admin' } };
  const profile = { role: 'admin', full_name: 'Admin', last_seen_at: null };
  const query = {
    select: () => query,
    eq: () => query,
    update: () => query,
    single: () => state.lock.then(() => ({ data: profile, error: null })),
    then: (res: (v: unknown) => unknown) => state.lock.then(() => res({ data: null, error: null })),
  };
  return { state, session, query };
});

vi.mock('../../lib/supabase', () => ({
  supabase: {
    from: () => h.query,
    auth: {
      getSession: () => h.state.lock.then(() => ({ data: { session: h.session }, error: null })),
      onAuthStateChange: (cb: Cb) => {
        h.state.cb = cb;
        return { data: { subscription: { unsubscribe: () => {} } } };
      },
      signOut: async () => ({ error: null }),
    },
  },
}));

vi.mock('../../lib/query-client', () => ({
  queryClient: {
    resumePausedMutations: async () => {},
    isMutating: () => 1,
    invalidateQueries: () => {},
    removeQueries: () => {},
    clear: () => {},
  },
  persister: { removeClient: async () => {} },
  cleanupCorruptedMutations: async () => 0,
}));

import { AuthProvider, useAuth } from '../AuthContext';

/** What auth-js does: take the lock, await every subscriber, then release it. */
async function emitInsideLock(event: string) {
  h.state.lock = new Promise<void>((r) => (h.state.release = r));
  await h.state.cb?.(event, h.session);
  h.state.release();
}

describe('AuthProvider under the auth lock (bug-046)', () => {
  it('a cold start with no cached role resolves the real role, not the timeout fallback', async () => {
    localStorage.clear();
    const wrapper = ({ children }: { children: ReactNode }) => (
      <AuthProvider>{children}</AuthProvider>
    );
    const { result } = renderHook(() => useAuth(), { wrapper });

    const started = Date.now();
    await act(async () => {
      await emitInsideLock('INITIAL_SESSION');
    });

    await waitFor(() => expect(result.current.loading).toBe(false), { timeout: 1500 });
    expect(result.current.isAdmin).toBe(true);
    expect(Date.now() - started).toBeLessThan(1500);
    expect(localStorage.getItem('role_u-admin')).toBe('admin');
  });

  it('the callback returns without awaiting anything', () => {
    const out = h.state.cb?.('TOKEN_REFRESHED', h.session);
    expect(out).toBeUndefined();
  });
});
