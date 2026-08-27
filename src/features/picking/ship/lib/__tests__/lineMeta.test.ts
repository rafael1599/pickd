import { describe, it, expect } from 'vitest';
import { resolveLineMeta } from '../lineMeta';

describe('resolveLineMeta', () => {
  // 2026-08-27: 03-3845BR (a bike since February, 45 lb) combined into
  // completed order 881301 — counted as a part and asked for a weight while
  // the live map was still loading.
  it('reads the stamp when the live map has not arrived yet', () => {
    const m = resolveLineMeta('03-3845BR', undefined, { is_bike: true, weight_lbs: 45 });
    expect(m).toEqual({ is_bike: true, weight_lbs: 45, missingWeight: false });
  });

  it('prefers the live catalog (a weight fixed after the order was written)', () => {
    const m = resolveLineMeta(
      '03-3845BR',
      { is_bike: true, weight_lbs: 43.4 },
      { is_bike: true, weight_lbs: 45 }
    );
    expect(m.weight_lbs).toBe(43.4);
  });

  it('falls back to the stamp field by field', () => {
    const m = resolveLineMeta('03-3845BR', { is_bike: true, weight_lbs: null }, { weight_lbs: 45 });
    expect(m).toEqual({ is_bike: true, weight_lbs: 45, missingWeight: false });
  });

  it('with no source at all, only a boxed-bike weight makes it a bike', () => {
    expect(resolveLineMeta('12-0506BK', undefined, undefined).is_bike).toBe(false);
    expect(resolveLineMeta('12-0506BK', undefined, { weight_lbs: 40 }).is_bike).toBe(true);
    expect(resolveLineMeta('12-0506BK', undefined, undefined).missingWeight).toBe(true);
  });

  it('an explicit part stays a part whatever it weighs', () => {
    expect(resolveLineMeta('99-3604', undefined, { is_bike: false, weight_lbs: 40 }).is_bike).toBe(
      false
    );
  });
});
