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
