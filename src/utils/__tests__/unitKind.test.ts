import { describe, expect, it } from 'vitest';
import { unitKindOf, unitKindStyle } from '../unitKind';

describe('unitKindStyle', () => {
  it('gives each special kind its label and colour', () => {
    expect(unitKindStyle('sd')).toMatchObject({ label: 'S/D', dot: 'bg-orange-500' });
    expect(unitKindStyle('photo')).toMatchObject({ label: 'PH', dot: 'bg-sky-500' });
    expect(unitKindStyle('return')).toMatchObject({ label: 'RET', dot: 'bg-purple-500' });
  });

  it('leaves a new unit, and anything unknown, unmarked', () => {
    expect(unitKindStyle('new')).toBeNull();
    expect(unitKindStyle(null)).toBeNull();
    expect(unitKindStyle('demo')).toBeNull();
  });

  it('never uses amber: it is a ROW square and «not saved»', () => {
    for (const k of ['sd', 'photo', 'return']) {
      expect(unitKindStyle(k)!.chip).not.toMatch(/amber/);
    }
  });
});

describe('unitKindOf', () => {
  it('reads unit_kind first', () => {
    expect(unitKindOf({ unit_kind: 'photo' })).toBe('photo');
    expect(unitKindOf({ unit_kind: 'return', is_scratch_dent: false })).toBe('return');
  });

  it('falls back to is_scratch_dent on an older read', () => {
    expect(unitKindOf({ is_scratch_dent: true })).toBe('sd');
    expect(unitKindOf({ unit_kind: 'new', is_scratch_dent: true })).toBe('sd');
    expect(unitKindOf(null)).toBe('new');
  });
});
