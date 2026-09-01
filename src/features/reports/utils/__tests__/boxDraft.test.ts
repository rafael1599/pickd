import { describe, it, expect } from 'vitest';
import { kgToLbs, lbsToKg, weightToLbs, lbsToUnit, planBoxSave } from '../boxDraft';
import { EMPTY_CARTON_DRAFT, type CartonDraft } from '../../../picking/utils/cartonDraft';

const draft = (one = '', two = '', three = ''): CartonDraft => ({ one, two, three });

describe('kg / lbs', () => {
  it('converts a boxed bike both ways', () => {
    expect(kgToLbs(20.5)).toBe(45.2);
    expect(lbsToKg(45.2)).toBe(20.5);
  });

  it('survives a round trip at the tenth', () => {
    for (const kg of [1, 5.5, 18.1, 20.5, 36.3]) {
      expect(lbsToKg(kgToLbs(kg))).toBe(kg);
    }
  });

  it('reads what was typed in the screen unit', () => {
    expect(weightToLbs('20.5', 'kg')).toBe(45.2);
    expect(weightToLbs('45.2', 'lbs')).toBe(45.2);
  });

  it('refuses a weight that is not one', () => {
    expect(weightToLbs('', 'kg')).toBeNull();
    expect(weightToLbs('0', 'kg')).toBeNull();
    expect(weightToLbs('-3', 'lbs')).toBeNull();
    expect(weightToLbs('abc', 'lbs')).toBeNull();
  });

  it('shows a stored weight back in the chosen unit', () => {
    expect(lbsToUnit(45.2, 'lbs')).toBe(45.2);
    expect(lbsToUnit(45.2, 'kg')).toBe(20.5);
  });
});

describe('planBoxSave', () => {
  it('saves the three sides on their own', () => {
    expect(planBoxSave(draft('8.75', '57', '31'), '', 'lbs', 45)).toEqual({
      sides: [8.75, 57, 31],
      weightLbs: null,
      blocked: null,
    });
  });

  it('saves a weight on its own — a scale without a tape measure is still a trip', () => {
    expect(planBoxSave(EMPTY_CARTON_DRAFT, '20.5', 'kg', 45)).toEqual({
      sides: null,
      weightLbs: 45.2,
      blocked: null,
    });
  });

  it('saves both together', () => {
    expect(planBoxSave(draft('8.75', '57', '31'), '20.5', 'kg', 45)).toEqual({
      sides: [8.75, 57, 31],
      weightLbs: 45.2,
      blocked: null,
    });
  });

  it('refuses half-typed sides even when a weight is there', () => {
    const plan = planBoxSave(draft('57', '', ''), '20.5', 'kg', 45);
    expect(plan.blocked).toBe('incomplete_sides');
    expect(plan.sides).toBeNull();
    expect(plan.weightLbs).toBeNull();
  });

  it('refuses a side that cannot reach FedEx — the field carries 3 characters', () => {
    expect(planBoxSave(draft('1200', '57', '31'), '', 'lbs', 45).blocked).toBe('bad_sides');
  });

  // A lost decimal is NOT caught here, and that is by design: the three sides
  // are sorted into columns, so 875 lands in the longest slot and the carton
  // ordering holds by construction. What catches it is the echo on the card --
  // "875 long" is visibly not a bike box. See cartonDraft.ts.
  it('lets a lost decimal through to the echo rather than blocking on it', () => {
    expect(planBoxSave(draft('875', '57', '31'), '', 'lbs', 45).blocked).toBeNull();
  });

  it('has nothing to save when nothing was typed', () => {
    expect(planBoxSave(EMPTY_CARTON_DRAFT, '', 'lbs', 45).blocked).toBe('empty');
  });

  it('does not rewrite the weight already on the row', () => {
    const plan = planBoxSave(draft('8.75', '57', '31'), '45', 'lbs', 45);
    expect(plan.weightLbs).toBeNull();
    expect(plan.sides).toEqual([8.75, 57, 31]);
  });

  it('but re-typing the stored weight alone is not a save', () => {
    expect(planBoxSave(EMPTY_CARTON_DRAFT, '45', 'lbs', 45).blocked).toBe('empty');
  });
});
