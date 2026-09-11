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

  it('keeps a freight note that says anything else', () => {
    expect(meaningfulNote('FREE FREIGHT, not ready')).toBe('FREE FREIGHT, not ready');
    // An unknown word is information too — the rule never drops it.
    expect(meaningfulNote('FREE FREIGHT notation')).toBe('FREE FREIGHT notation');
  });

  it('drops the billing codes of real AS400 notes', () => {
    // One rule with the Ship sign (utils/orderNoteSignals): these used to show
    // in Double Check's red line because the old filter only knew "freight".
    expect(meaningfulNote('NET 60 - FREE FREIGHT')).toBeNull();
    expect(meaningfulNote('FF N30 W/FLA')).toBeNull();
    expect(meaningfulNote('ACH')).toBeNull();
    expect(meaningfulNote('EP PURCHASE')).toBeNull();
    expect(meaningfulNote('FREIGH $75.00')).toBeNull();
  });

  it('keeps a PO number, and removes what PickD appended', () => {
    expect(meaningfulNote('PO# 4501236083')).toBe('PO# 4501236083');
    expect(meaningfulNote('HOLD FOR ADDS [User Cancelled]')).toBe('HOLD FOR ADDS');
    expect(meaningfulNote('User Cancelled')).toBeNull();
  });
});
