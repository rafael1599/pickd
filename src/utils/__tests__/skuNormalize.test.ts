import { describe, it, expect } from 'vitest';
import {
  canonicalBikeSku,
  resolveInventorySku,
  getSubstituteSku,
  normalizeSkuOnRegister,
  formatSkuForDisplay,
  rawSkuForStore,
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
  it('returns the hardcoded substitute for an out-of-stock SKU', () => {
    expect(getSubstituteSku('03-3768BL')).toBe('03-3768BLD');
  });

  it('returns null for a SKU with no substitute', () => {
    expect(getSubstituteSku('03-3726RD')).toBeNull();
    expect(getSubstituteSku('128353')).toBeNull();
  });

  it('de-mangles a spurious trailing letter before looking up the map', () => {
    // A watcher-mangled "03-3768BLX" canonicalizes to 03-3768BL → substitute applies.
    expect(getSubstituteSku('03-3768BLX')).toBe('03-3768BLD');
  });

  it('never returns the input SKU itself (no self-substitution)', () => {
    // 03-3768BLD canonicalizes to 03-3768BL whose substitute IS 03-3768BLD —
    // that must resolve to null, not a no-op swap onto itself.
    expect(getSubstituteSku('03-3768BLD')).toBeNull();
  });

  it('handles null/empty/whitespace safely', () => {
    expect(getSubstituteSku(null)).toBeNull();
    expect(getSubstituteSku(undefined)).toBeNull();
    expect(getSubstituteSku('   ')).toBeNull();
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

describe('formatSkuForDisplay', () => {
  it('inserts the dash for 6-digit numeric part SKUs', () => {
    expect(formatSkuForDisplay('480520')).toBe('48-0520');
    expect(formatSkuForDisplay('128353')).toBe('12-8353');
    expect(formatSkuForDisplay('000464')).toBe('00-0464');
  });

  it('inserts the dash for bike-style undashed SKUs (with color code)', () => {
    expect(formatSkuForDisplay('023680GY')).toBe('02-3680GY');
    expect(formatSkuForDisplay('033779RDD')).toBe('03-3779RDD');
  });

  it('leaves already-dashed SKUs unchanged (idempotent)', () => {
    expect(formatSkuForDisplay('03-3768BL')).toBe('03-3768BL');
    expect(formatSkuForDisplay(formatSkuForDisplay('480520'))).toBe('48-0520');
  });

  it('does NOT dash UPCs / tracking numbers (more than six digits)', () => {
    expect(formatSkuForDisplay('496942473266')).toBe('496942473266');
    expect(formatSkuForDisplay('792212140716')).toBe('792212140716');
  });

  it('leaves text SKUs and short codes untouched', () => {
    expect(formatSkuForDisplay('BRAKE')).toBe('BRAKE');
    expect(formatSkuForDisplay('AVID-BB5/7')).toBe('AVID-BB5/7');
    expect(formatSkuForDisplay('8153')).toBe('8153');
  });

  it('handles null/empty safely', () => {
    expect(formatSkuForDisplay(null)).toBe('');
    expect(formatSkuForDisplay(undefined)).toBe('');
    expect(formatSkuForDisplay('')).toBe('');
  });
});

describe('rawSkuForStore', () => {
  it('strips the catalog dash from pure-numeric part SKUs', () => {
    expect(rawSkuForStore('48-0520')).toBe('480520');
    expect(rawSkuForStore('12-8353')).toBe('128353');
  });

  it('keeps the dash on bike SKUs (color-code letters → dash-canonical)', () => {
    expect(rawSkuForStore('03-3768BL')).toBe('03-3768BL');
  });

  it('round-trips with formatSkuForDisplay for numeric parts', () => {
    expect(rawSkuForStore(formatSkuForDisplay('480520'))).toBe('480520');
  });

  it('leaves text / undashed / UPC SKUs untouched', () => {
    expect(rawSkuForStore('480520')).toBe('480520');
    expect(rawSkuForStore('BRAKE')).toBe('BRAKE');
    expect(rawSkuForStore('AVID-BB5/7')).toBe('AVID-BB5/7');
    expect(rawSkuForStore('496942473266')).toBe('496942473266');
  });

  it('handles null/empty safely', () => {
    expect(rawSkuForStore(null)).toBe('');
    expect(rawSkuForStore(undefined)).toBe('');
    expect(rawSkuForStore('')).toBe('');
  });
});
