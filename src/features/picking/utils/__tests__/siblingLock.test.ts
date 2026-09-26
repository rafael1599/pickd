import { describe, expect, it } from 'vitest';
import { siblingHeldByOther } from '../siblingLock';

const ME = 'rafael';
const OTHER = 'roman';

describe('siblingHeldByOther (bug-035)', () => {
  it('a sibling a teammate completed is a signature, not a lock', () => {
    expect(siblingHeldByOther({ status: 'completed', checked_by: OTHER }, ME)).toBe(false);
  });

  it('a cancelled sibling does not lock', () => {
    expect(siblingHeldByOther({ status: 'cancelled', checked_by: OTHER }, ME)).toBe(false);
  });

  it('a reopened sibling keeps the completer in checked_by and does not lock', () => {
    expect(siblingHeldByOther({ status: 'reopened', checked_by: OTHER }, ME)).toBe(false);
  });

  it('a sibling a teammate is verifying locks', () => {
    expect(siblingHeldByOther({ status: 'double_checking', checked_by: OTHER }, ME)).toBe(true);
  });

  it('an open sibling a teammate holds while picking locks', () => {
    expect(siblingHeldByOther({ status: 'active', checked_by: OTHER }, ME)).toBe(true);
    expect(siblingHeldByOther({ status: 'needs_correction', checked_by: OTHER }, ME)).toBe(true);
  });

  it('my own lock and no lock never block', () => {
    expect(siblingHeldByOther({ status: 'double_checking', checked_by: ME }, ME)).toBe(false);
    expect(siblingHeldByOther({ status: 'double_checking', checked_by: null }, ME)).toBe(false);
  });
});
