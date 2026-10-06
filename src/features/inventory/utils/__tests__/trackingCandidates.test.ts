import { describe, it, expect } from 'vitest';
import { bestTracking, looksLikeTracking, trackingCandidates } from '../trackingCandidates';

describe('trackingCandidates', () => {
  it('finds the tracking at the end of a GS1-128 string', () => {
    const c = trackingCandidates(['9622001900007480000300792270157942']);
    expect(bestTracking(c)).toBe('792270157942');
  });

  it('prefers 12 digits, then 15', () => {
    expect(bestTracking(['ABC', '600623040231430', '792077209438'])).toBe('792077209438');
    expect(bestTracking(['ABC', '600623040231430'])).toBe('600623040231430');
    expect(bestTracking([])).toBeNull();
  });

  it('flags what is not 12–15 digits', () => {
    expect(looksLikeTracking('792270157942')).toBe(true);
    expect(looksLikeTracking('03-4229BL')).toBe(false);
  });
});
