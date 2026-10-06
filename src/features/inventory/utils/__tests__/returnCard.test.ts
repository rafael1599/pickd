import { describe, expect, it } from 'vitest';
import { daysWaiting } from '../returnCard';

describe('daysWaiting', () => {
  const now = Date.parse('2026-10-06T13:00:00Z');
  it('counts whole days since the return came in', () => {
    // 792270157942 came in on 27 Apr 2026.
    expect(daysWaiting('2026-04-27T14:10:08Z', now)).toBe(161);
    expect(daysWaiting('2026-10-06T08:00:00Z', now)).toBe(0);
  });
  it('says nothing when nobody knows', () => {
    expect(daysWaiting(null, now)).toBeNull();
  });
});
