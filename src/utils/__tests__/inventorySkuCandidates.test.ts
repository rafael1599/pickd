import { describe, it, expect } from 'vitest';
import { inventorySkuCandidates } from '../skuNormalize';

describe('inventorySkuCandidates', () => {
  // The reported case: the watcher reads "03 4664 BR" and can emit it collapsed,
  // which matches no inventory row. Nine orders were fixed by hand this way.
  it('offers the dashed form for a collapsed bike SKU', () => {
    const candidates = inventorySkuCandidates('034664BR');
    expect(candidates[0]).toBe('034664BR');
    expect(candidates).toContain('03-4664BR');
  });

  // Non-negotiable: eight SKUs really are stored without a dash and four hold
  // live stock, so the exact form must always be tried first.
  it('always puts the exact SKU first', () => {
    expect(inventorySkuCandidates('700106BK')[0]).toBe('700106BK');
    expect(inventorySkuCandidates('860005BK')[0]).toBe('860005BK');
    expect(inventorySkuCandidates('03-3768BL')[0]).toBe('03-3768BL');
  });

  it('keeps the de-mangled form as a later guess', () => {
    const candidates = inventorySkuCandidates('03-3768BLD');
    expect(candidates[0]).toBe('03-3768BLD');
    expect(candidates).toContain('03-3768BL');
  });

  it('applies the AS400 alias', () => {
    expect(inventorySkuCandidates('03-4070BL')).toContain('03-4070BK');
  });

  it('covers a SKU that is both collapsed and mangled', () => {
    const candidates = inventorySkuCandidates('033769BLD');
    expect(candidates[0]).toBe('033769BLD');
    expect(candidates).toContain('03-3769BL');
  });

  it('offers the canonical AS400 form for a glued 6-digit number, exact first', () => {
    expect(inventorySkuCandidates('651000')).toEqual(['651000', '65-1000']);
  });

  it('returns no candidates for an empty SKU', () => {
    expect(inventorySkuCandidates('')).toEqual([]);
    expect(inventorySkuCandidates(null)).toEqual([]);
  });

  it('never repeats a candidate', () => {
    const candidates = inventorySkuCandidates('03-3931BK');
    expect(new Set(candidates).size).toBe(candidates.length);
  });
});
