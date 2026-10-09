import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NavigatorLockAcquireTimeoutError } from '@supabase/supabase-js';

// Unmock ../supabase since setup.ts mocks it globally
vi.unmock('../supabase');

const mockNavigatorLock = vi.fn();

vi.mock('@supabase/supabase-js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@supabase/supabase-js')>();
  return {
    ...actual,
    navigatorLock: (...args: unknown[]) => mockNavigatorLock(...args),
  };
});

describe('bug-048: authLock behavior on busy lock', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('con timeout 0 y lock ocupado: lanza NavigatorLockAcquireTimeoutError y fn() NO se ejecuta', async () => {
    const { authLock } = await import('../supabase');

    // Simulate navigatorLock immediately failing when acquireTimeout is 0
    mockNavigatorLock.mockImplementation(async (name: string, timeout: number) => {
      if (timeout === 0) {
        throw new NavigatorLockAcquireTimeoutError(
          `Acquiring an exclusive Navigator LockManager lock "${name}" immediately failed`
        );
      }
    });

    const fn = vi.fn().mockResolvedValue('success');

    // Must throw NavigatorLockAcquireTimeoutError
    await expect(authLock('test-lock', 0, fn)).rejects.toThrow(NavigatorLockAcquireTimeoutError);

    // fn must NOT have been called (cannot run without lock when acquireTimeout is 0)
    expect(fn).not.toHaveBeenCalled();
  });

  it('con timeout > 0 (ej. 5000) que expira: advierte en consola y ejecuta fn() como fallback', async () => {
    const { authLock } = await import('../supabase');
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    // Simulate navigatorLock timing out after waiting
    mockNavigatorLock.mockImplementation(async (name: string) => {
      throw new NavigatorLockAcquireTimeoutError(`Lock "${name}" acquire timed out`);
    });

    const fn = vi.fn().mockResolvedValue('fallback-result');

    const result = await authLock('test-lock', 5000, fn);

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining(
        '[authLock] Lock "test-lock" acquire timed out or aborted — executing without lock'
      )
    );
    expect(fn).toHaveBeenCalledTimes(1);
    expect(result).toBe('fallback-result');

    warnSpy.mockRestore();
  });

  it('con lock disponible: ejecuta fn() dentro del lock y retorna su resultado', async () => {
    const { authLock } = await import('../supabase');

    mockNavigatorLock.mockImplementation(
      async (_name: string, _timeout: number, callback: () => Promise<unknown>) => {
        return await callback();
      }
    );

    const fn = vi.fn().mockResolvedValue('normal-result');

    const result = await authLock('test-lock', 0, fn);

    expect(fn).toHaveBeenCalledTimes(1);
    expect(result).toBe('normal-result');
  });
});
