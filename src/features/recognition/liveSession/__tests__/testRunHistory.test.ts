import { describe, it, expect, vi } from 'vitest';
import { saveLiveCheckTestRun, shortCommitFromBuild } from '../testRunHistory';

describe('shortCommitFromBuild', () => {
  it('takes the commit before the first dash, same as buildCommit() in useAppUpdate', () => {
    expect(shortCommitFromBuild('37bd187-1758000000000')).toBe('37bd187');
  });

  it('returns null for an empty build', () => {
    expect(shortCommitFromBuild('')).toBeNull();
  });
});

describe('saveLiveCheckTestRun', () => {
  const baseInput = {
    createdBy: 'user-123',
    orderNumbers: ['881650'],
    groupId: null,
    boxesConfirmed: 2,
    bikesRequired: 2,
    durationSeconds: 193,
    appBuild: '37bd187-1758000000000',
    userAgent:
      'Mozilla/5.0 (Linux; Android 15; SM-S938B) AppleWebKit/537.36 (KHTML, like Gecko) ' +
      'Chrome/128.0.0.0 Mobile Safari/537.36',
    telemetry: { tipo: 'TELEMETRIA_BARRIDO_LIVE_CHECK_R15' },
  };

  it('inserts a row with device info parsed from the user agent and the short commit', async () => {
    const insertMock = vi.fn().mockResolvedValue({ error: null });
    const mockSupabase = {
      from: vi.fn().mockReturnValue({ insert: insertMock }),
    } as any;

    const ok = await saveLiveCheckTestRun(mockSupabase, baseInput);

    expect(ok).toBe(true);
    expect(mockSupabase.from).toHaveBeenCalledWith('live_check_test_runs');
    expect(insertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        created_by: 'user-123',
        order_numbers: ['881650'],
        boxes_confirmed: 2,
        bikes_required: 2,
        duration_seconds: 193,
        app_build: '37bd187-1758000000000',
        app_commit: '37bd187',
        device_label: 'SM-S938B',
        device_os: 'Android 15',
        device_is_mobile: true,
      })
    );
  });

  it('returns false and never throws when the insert fails', async () => {
    const insertMock = vi.fn().mockResolvedValue({ error: { message: 'RLS denied' } });
    const mockSupabase = {
      from: vi.fn().mockReturnValue({ insert: insertMock }),
    } as any;

    const ok = await saveLiveCheckTestRun(mockSupabase, baseInput);
    expect(ok).toBe(false);
  });

  it('returns false and never throws when the client itself throws', async () => {
    const mockSupabase = {
      from: vi.fn(() => {
        throw new Error('offline');
      }),
    } as any;

    const ok = await saveLiveCheckTestRun(mockSupabase, baseInput);
    expect(ok).toBe(false);
  });
});
