import { describe, it, expect } from 'vitest';
import { formatStockSearchInput, resolveSearchField } from '../stockSearch';

/** Types `text` one character at a time, as the input's onChange would. */
function type(text: string, mode: Parameters<typeof formatStockSearchInput>[2], start = '') {
  let value = start;
  for (const ch of text) value = formatStockSearchInput(value, value + ch, mode);
  return value;
}

describe('resolveSearchField', () => {
  it.each([
    ['0', 'sku'],
    ['03', 'sku'],
    ['03-47', 'sku'],
    ['034710', 'sku'],
    ['03-4710BL', 'sku'],
    ['TRAIL', 'all'],
    ['ROW 12', 'all'],
    ['Y21I001153', 'all'],
    ['845438006710', 'all'],
    ['PKD-001', 'all'],
  ] as const)('auto: %s → %s', (term, field) => {
    expect(resolveSearchField(term, 'auto')).toBe(field);
  });

  it('a pinned mode wins over what the term looks like', () => {
    expect(resolveSearchField('03-47', 'name')).toBe('name');
    expect(resolveSearchField('TRAIL', 'sku')).toBe('sku');
    expect(resolveSearchField('12', 'location')).toBe('location');
  });
});

describe('formatStockSearchInput', () => {
  it('puts the dash after the first two digits while typing a SKU', () => {
    expect(type('034710', 'auto')).toBe('03-4710');
    expect(type('034710bl', 'auto')).toBe('03-4710BL');
  });

  it('does not double a dash the operator typed', () => {
    expect(type('03-4710', 'auto')).toBe('03-4710');
  });

  it('adds the dash to a pasted SKU', () => {
    expect(formatStockSearchInput('', '034710', 'auto')).toBe('03-4710');
  });

  it('lets backspace remove the dash', () => {
    expect(formatStockSearchInput('03-', '03', 'auto')).toBe('03');
    expect(formatStockSearchInput('03-4', '03-', 'auto')).toBe('03-');
  });

  it('in auto, a UPC loses the dash once it is too long for a SKU', () => {
    expect(type('845438006710', 'auto')).toBe('845438006710');
  });

  it('in SKU mode the dash stays and letters go uppercase', () => {
    expect(type('0123456', 'sku')).toBe('01-23456');
    expect(type('034710bl', 'sku')).toBe('03-4710BL');
  });

  it('leaves text alone in auto and in the other modes', () => {
    expect(type('row 12', 'auto')).toBe('row 12');
    expect(type('034710', 'name')).toBe('034710');
    expect(type('034710', 'serial')).toBe('034710');
  });
});
