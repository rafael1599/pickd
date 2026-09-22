import { describe, expect, it } from 'vitest';
import { buildCommit, isNewerBuild } from '../useAppUpdate';

describe('isNewerBuild — is a different build being served?', () => {
  it('only a different build id counts', () => {
    expect(isNewerBuild({ build: '37bd187-mfa1' }, '37bc626-mf9z')).toBe(true);
    expect(isNewerBuild({ build: '37bd187-mfa1' }, '37bd187-mfa1')).toBe(false);
  });
  it('a missing or odd file says nothing — an older deploy served index.html instead', () => {
    expect(isNewerBuild(null, 'x')).toBe(false);
    expect(isNewerBuild({}, 'x')).toBe(false);
    expect(isNewerBuild({ build: '' }, 'x')).toBe(false);
    expect(isNewerBuild('<!doctype html>', 'x')).toBe(false);
  });
  it('the menu shows the commit', () => {
    expect(buildCommit('37bd187-mfa1')).toBe('37bd187');
  });
});

describe('the status pill hears about it — no toast (22 sep 2026)', () => {
  it('starts quiet and turns on for every listener at once', async () => {
    const { act, renderHook } = await import('@testing-library/react');
    const { markNewBuild, useNewBuildAvailable } = await import('../useAppUpdate');

    const header = renderHook(() => useNewBuildAvailable());
    const elsewhere = renderHook(() => useNewBuildAvailable());
    expect(header.result.current).toBe(false);
    expect(elsewhere.result.current).toBe(false);

    act(() => markNewBuild());
    expect(header.result.current).toBe(true);
    expect(elsewhere.result.current).toBe(true);
  });

  it('does not take it back: a page stays old until it reloads', async () => {
    const { act, renderHook } = await import('@testing-library/react');
    const { markNewBuild, useNewBuildAvailable } = await import('../useAppUpdate');

    const { result } = renderHook(() => useNewBuildAvailable());
    act(() => markNewBuild());
    act(() => markNewBuild());
    expect(result.current).toBe(true);
  });
});
