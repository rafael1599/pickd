import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  canonicalBikeSku,
  resolveInventorySku,
  getSubstituteSku,
  normalizeSkuOnRegister,
  SKU_SUBSTITUTES,
  variantSiblingBase,
  isVariantSibling,
} from '../skuNormalize';

describe('canonicalBikeSku', () => {
  it('strips a spurious extra trailing letter from a bike SKU', () => {
    expect(canonicalBikeSku('03-3768BLD')).toBe('03-3768BL');
    expect(canonicalBikeSku('03-3769BLD')).toBe('03-3769BL');
  });

  it('leaves a regular 2-letter bike SKU unchanged', () => {
    expect(canonicalBikeSku('03-3768BL')).toBe('03-3768BL');
    expect(canonicalBikeSku('06-4427RB')).toBe('06-4427RB');
  });

  it('strips multiple extra trailing letters down to the canonical 2', () => {
    expect(canonicalBikeSku('03-3768BLDX')).toBe('03-3768BL');
  });

  it('does not touch non-bike-pattern SKUs', () => {
    expect(canonicalBikeSku('128353')).toBe('128353');
    expect(canonicalBikeSku('700108')).toBe('700108');
    expect(canonicalBikeSku('860027BK')).toBe('860027BK');
    expect(canonicalBikeSku('992604')).toBe('992604');
  });

  it('handles null/empty safely', () => {
    expect(canonicalBikeSku(null)).toBe('');
    expect(canonicalBikeSku(undefined)).toBe('');
    expect(canonicalBikeSku('  ')).toBe('');
  });

  it('trims whitespace', () => {
    expect(canonicalBikeSku('  03-3768BLD ')).toBe('03-3768BL');
  });
});

describe('resolveInventorySku', () => {
  it('applies the explicit AS400 alias (03-4070BL is stocked as 03-4070BK)', () => {
    expect(resolveInventorySku('03-4070BL')).toBe('03-4070BK');
  });

  it('de-mangles the trailing letter before applying the alias', () => {
    expect(resolveInventorySku('03-4070BLD')).toBe('03-4070BK');
  });

  it('falls back to the canonical SKU when there is no alias', () => {
    expect(resolveInventorySku('03-3768BLD')).toBe('03-3768BL');
    expect(resolveInventorySku('03-3768BL')).toBe('03-3768BL');
    expect(resolveInventorySku('128353')).toBe('128353');
  });

  it('never maps the inventory-side SKU itself', () => {
    expect(resolveInventorySku('03-4070BK')).toBe('03-4070BK');
  });
});

describe('getSubstituteSku', () => {
  // The shipped map is empty — variant siblings are resolved by stock, see
  // SKU_SUBSTITUTES — so seed a genuine "different product" entry to exercise
  // the contract, and take it out again.
  beforeAll(() => {
    SKU_SUBSTITUTES['03-9001BK'] = '03-8001BK';
  });
  afterAll(() => {
    delete SKU_SUBSTITUTES['03-9001BK'];
  });

  it('returns the hardcoded substitute for an out-of-stock SKU', () => {
    expect(getSubstituteSku('03-9001BK')).toBe('03-8001BK');
  });

  it('returns null for a SKU with no substitute', () => {
    expect(getSubstituteSku('03-3726RD')).toBeNull();
    expect(getSubstituteSku('128353')).toBeNull();
  });

  it('de-mangles a spurious trailing letter before looking up the map', () => {
    // A watcher-mangled "03-9001BKX" canonicalizes to 03-9001BK → substitute applies.
    expect(getSubstituteSku('03-9001BKX')).toBe('03-8001BK');
  });

  it('never returns the input SKU itself (no self-substitution)', () => {
    SKU_SUBSTITUTES['03-9002BK'] = '03-9002BKD';
    try {
      // 03-9002BKD canonicalizes to 03-9002BK whose substitute IS 03-9002BKD —
      // that must resolve to null, not a no-op swap onto itself.
      expect(getSubstituteSku('03-9002BKD')).toBeNull();
    } finally {
      delete SKU_SUBSTITUTES['03-9002BK'];
    }
  });

  it('never pairs variant siblings: 03-3768BL/BLD and 03-3769BL/BLD are resolved by stock', () => {
    // They were in this map, and the entry went backwards the morning after the
    // operator renamed the inventory row (2026-08-25). A sibling entry here is
    // a bug by definition — the same bike does not need a "substitute".
    for (const [from, to] of Object.entries(SKU_SUBSTITUTES)) {
      expect(isVariantSibling(from, to)).toBe(false);
    }
    expect(getSubstituteSku('03-3768BL')).toBeNull();
    expect(getSubstituteSku('03-3768BLD')).toBeNull();
    expect(getSubstituteSku('03-3769BL')).toBeNull();
  });

  it('handles null/empty/whitespace safely', () => {
    expect(getSubstituteSku(null)).toBeNull();
    expect(getSubstituteSku(undefined)).toBeNull();
    expect(getSubstituteSku('   ')).toBeNull();
  });
});

describe('variantSiblingBase / isVariantSibling', () => {
  it('returns the dept-number-color base for a bike SKU with or without a finish letter', () => {
    expect(variantSiblingBase('03-3768BL')).toBe('03-3768BL');
    expect(variantSiblingBase('03-3768BLD')).toBe('03-3768BL');
    expect(variantSiblingBase(' 03-3769BLT ')).toBe('03-3769BL');
  });

  it('returns null for parts, UPCs, dashless, over-long and empty input', () => {
    expect(variantSiblingBase('01-522')).toBeNull();
    expect(variantSiblingBase('128353')).toBeNull();
    expect(variantSiblingBase('033768BLD')).toBeNull();
    expect(variantSiblingBase('03-3768BLDX')).toBeNull();
    expect(variantSiblingBase('03-3768')).toBeNull();
    expect(variantSiblingBase(null)).toBeNull();
    expect(variantSiblingBase(undefined)).toBeNull();
    expect(variantSiblingBase('')).toBeNull();
  });

  it('is case-sensitive like the rest of the catalog matching', () => {
    // 03-3666Bl (lower-case L) is a known bad record, not a family member.
    expect(variantSiblingBase('03-3666Bl')).toBeNull();
  });

  it('is symmetric and never pairs a SKU with itself', () => {
    expect(isVariantSibling('03-3768BL', '03-3768BLD')).toBe(true);
    expect(isVariantSibling('03-3768BLD', '03-3768BL')).toBe(true);
    expect(isVariantSibling('03-3768BLD', '03-3768BLT')).toBe(true);
    expect(isVariantSibling('03-3768BL', '03-3768BL')).toBe(false);
    expect(isVariantSibling('03-3768BL', ' 03-3768BL ')).toBe(false);
  });

  it('does not pair different colors, different models or non-bike codes', () => {
    expect(isVariantSibling('03-4070BL', '03-4070BK')).toBe(false); // AS400 alias territory
    expect(isVariantSibling('03-3768BL', '03-3769BL')).toBe(false);
    expect(isVariantSibling('03-3768BL', '01-522')).toBe(false);
    expect(isVariantSibling('01-522', '01-522A')).toBe(false);
    expect(isVariantSibling(null, '03-3768BL')).toBe(false);
  });
});

describe('normalizeSkuOnRegister', () => {
  it('inserts the dash after the 2-digit department code (bike-style SKUs)', () => {
    expect(normalizeSkuOnRegister('033768BLD')).toBe('03-3768BLD');
    expect(normalizeSkuOnRegister('034099BK')).toBe('03-4099BK');
    expect(normalizeSkuOnRegister('700106SK')).toBe('70-0106SK');
  });

  it('leaves pure-numeric codes (UPCs / part numbers) untouched', () => {
    expect(normalizeSkuOnRegister('128353')).toBe('128353');
    expect(normalizeSkuOnRegister('496942473266')).toBe('496942473266');
  });

  it('leaves an already-dashed SKU unchanged (idempotent)', () => {
    expect(normalizeSkuOnRegister('03-3768BL')).toBe('03-3768BL');
    expect(normalizeSkuOnRegister(normalizeSkuOnRegister('033768BL'))).toBe('03-3768BL');
  });

  it('trims, uppercases and strips internal spaces', () => {
    expect(normalizeSkuOnRegister('  033768bld ')).toBe('03-3768BLD');
    expect(normalizeSkuOnRegister('03 3768 BLD')).toBe('03-3768BLD');
  });

  it('does not touch SKUs that do not start with two digits', () => {
    expect(normalizeSkuOnRegister('ABC123')).toBe('ABC123');
    expect(normalizeSkuOnRegister('A1B2')).toBe('A1B2');
  });

  it('does not dash a bare 2-digit code (nothing after it)', () => {
    expect(normalizeSkuOnRegister('03')).toBe('03');
  });

  it('handles null/empty safely', () => {
    expect(normalizeSkuOnRegister(null)).toBe('');
    expect(normalizeSkuOnRegister(undefined)).toBe('');
    expect(normalizeSkuOnRegister('')).toBe('');
  });
});
