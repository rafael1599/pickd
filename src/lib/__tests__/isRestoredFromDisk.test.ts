import { describe, it, expect } from 'vitest';
import { isRestoredFromDisk } from '../query-client';

const q = (dataUpdatedAt: number) => ({ state: { dataUpdatedAt } });

describe('isRestoredFromDisk', () => {
  const boot = 1_000_000;

  it('is true for data fetched before this page load (restored snapshot)', () => {
    expect(isRestoredFromDisk(q(boot - 1), boot)).toBe(true);
  });

  it('is false for data fetched during this load — no second request', () => {
    expect(isRestoredFromDisk(q(boot), boot)).toBe(false);
    expect(isRestoredFromDisk(q(boot + 500), boot)).toBe(false);
  });

  it('is false for a query that never had data', () => {
    expect(isRestoredFromDisk(q(0), boot)).toBe(false);
  });
});
