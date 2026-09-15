import { describe, it, expect } from 'vitest';
import { expandModelAbbreviation } from '../modelAbbreviations';

describe('expandModelAbbreviation', () => {
  it.each([
    ['EC3', 'EARTH CRUISER 3 EC3'],
    ['EC3 21 2026 GLOSS BLACK', 'EARTH CRUISER 3 EC3 21 2026 GLOSS BLACK'],
    ['EC2 S/T', 'EARTH CRUISER 2 EC2 S/T'],
    ['BC7 S/O', 'BOSS CRUISER 7 BC7 S/O'],
    ['BCCB 17 2026 COSMO BLUE', 'BOSS CRUISER CB BCCB 17 2026 COSMO BLUE'],
    // The full name typed by hand gets its abbreviation, right after it.
    ['EARTH CRUISER 3', 'EARTH CRUISER 3 EC3'],
    ['Earth Cruiser 1 Step-Thru', 'Earth Cruiser 1 EC1 Step-Thru'],
    ['BOSS CRUISER 7 ST', 'BOSS CRUISER 7 BC7 ST'],
  ])('%s → %s', (input, expected) => {
    expect(expandModelAbbreviation(input)).toBe(expected);
  });

  it('is idempotent', () => {
    for (const s of ['EC3 21 GLOSS BLACK', 'BC7', 'EARTH CRUISER 2 STEP-THRU']) {
      const once = expandModelAbbreviation(s);
      expect(expandModelAbbreviation(once)).toBe(once);
    }
  });

  it.each([
    'CITIZEN 1 23 DEEP BLUE',
    'EC35 SOMETHING', // not the token EC3
    'PEDAL EC1', // an abbreviation that is not the model at the start
    'EARTH CRUISER', // no number: not a model we know
    '',
  ])('leaves %j alone', (input) => {
    expect(expandModelAbbreviation(input)).toBe(input);
  });

  it('keeps null / undefined as empty', () => {
    expect(expandModelAbbreviation(null)).toBe('');
    expect(expandModelAbbreviation(undefined)).toBe('');
  });
});
