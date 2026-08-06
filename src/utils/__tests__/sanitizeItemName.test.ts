import { describe, it, expect } from 'vitest';
import { sanitizeItemName } from '../sanitizeItemName';

describe('sanitizeItemName', () => {
  it('returns null for null, undefined, or whitespace', () => {
    expect(sanitizeItemName(null)).toBeNull();
    expect(sanitizeItemName(undefined)).toBeNull();
    expect(sanitizeItemName('')).toBeNull();
    expect(sanitizeItemName('   ')).toBeNull();
  });

  it('preserves clean bike names', () => {
    expect(sanitizeItemName('HELIX 16 MINT')).toBe('HELIX 16 MINT');
    expect(sanitizeItemName('DURANGO A2 17 2025 THUNDER GREY GREY')).toBe(
      'DURANGO A2 17 2025 THUNDER GREY GREY'
    );
  });

  it('strips AUTO-CANCEL and AUTO-RESTORE system chatter', () => {
    expect(
      sanitizeItemName('HELIX 16 MINT | AUTO-CANCEL VERIFICATION TIMEOUT | AUTO-RESTORE ON CANCEL')
    ).toBe('HELIX 16 MINT');
  });

  it('strips standalone system messages and returns null', () => {
    expect(sanitizeItemName('AUTO-CANCEL VERIFICATION TIMEOUT')).toBeNull();
    expect(sanitizeItemName('AUTO-RESTORE ON CANCEL')).toBeNull();
    expect(sanitizeItemName('VERIFICATION TIMEOUT')).toBeNull();
  });

  it('handles multiple pipes and removes empty segments', () => {
    expect(sanitizeItemName('TAXI 26 | VERIFICATION TIMEOUT | BLUE')).toBe('TAXI 26 | BLUE');
  });
});
