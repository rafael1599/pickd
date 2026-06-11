import { describe, it, expect } from 'vitest';
import { meaningfulNote } from '../meaningfulNote';

describe('meaningfulNote', () => {
  it('drops pure freight/billing noise', () => {
    expect(meaningfulNote('FREE FREIGHT')).toBeNull();
    expect(meaningfulNote('Freight $65.00')).toBeNull();
    expect(meaningfulNote('  FREIGHT  ')).toBeNull();
    expect(meaningfulNote('PREPAID')).toBeNull();
    expect(meaningfulNote('FOB')).toBeNull();
  });

  it('keeps notes carrying a real instruction even alongside freight', () => {
    expect(meaningfulNote('FREE FREIGHT — DO NOT SHIP UNTIL MONDAY')).toBe(
      'FREE FREIGHT — DO NOT SHIP UNTIL MONDAY'
    );
    expect(meaningfulNote('FREIGHT $65 — hold for pickup')).toBe('FREIGHT $65 — hold for pickup');
    expect(meaningfulNote('wait for inventory')).toBe('wait for inventory');
    expect(meaningfulNote('CALL BEFORE SHIPPING')).toBe('CALL BEFORE SHIPPING');
  });

  it('keeps unknown notes (never lose information)', () => {
    expect(meaningfulNote('Leave at dock 3')).toBe('Leave at dock 3');
    expect(meaningfulNote('Customer prefers UPS')).toBe('Customer prefers UPS');
  });

  it('returns null for empty/blank/nullish input', () => {
    expect(meaningfulNote(null)).toBeNull();
    expect(meaningfulNote(undefined)).toBeNull();
    expect(meaningfulNote('   ')).toBeNull();
  });

  it('uses a word boundary for the ambiguous word "not"', () => {
    // "notation" must NOT trigger the "not" KEEP rule, so a freight note with it
    // stays noise (dropped) — proving \bnot\b doesn't match inside another word.
    expect(meaningfulNote('FREE FREIGHT notation')).toBeNull();
    // But the standalone word "not" keeps the note.
    expect(meaningfulNote('FREE FREIGHT, not ready')).toBe('FREE FREIGHT, not ready');
  });
});
