import { describe, expect, it } from 'vitest';

import { aggregateScanResults, parseQRPayload } from '../parseQRPayload';

describe('parseQRPayload', () => {
  it('parses standard URL format', () => {
    const raw = 'https://app.pickd.io/tag/PK-42/abc123?sku=FRAME-001';
    const result = parseQRPayload(raw);
    expect(result).toEqual({ shortCode: 'PK-42', sku: 'FRAME-001' });
  });

  it('parses URL format with encoded SKU', () => {
    const raw = 'https://app.pickd.io/tag/PK-7/tok?sku=WHEEL%2FFRONT%2026';
    const result = parseQRPayload(raw);
    expect(result).toEqual({ shortCode: 'PK-7', sku: 'WHEEL/FRONT 26' });
  });

  it('parses legacy pipe format', () => {
    const raw = 'PK-99|SEAT-POST-27.2';
    const result = parseQRPayload(raw);
    expect(result).toEqual({ shortCode: 'PK-99', sku: 'SEAT-POST-27.2' });
  });

  it('returns null for invalid input', () => {
    expect(parseQRPayload('')).toBeNull();
    expect(parseQRPayload('random text')).toBeNull();
    expect(parseQRPayload('https://example.com/no-tag-here')).toBeNull();
    expect(parseQRPayload('NO-PREFIX|SKU')).toBeNull();
  });

  it('returns null for URL without sku param', () => {
    const raw = 'https://app.pickd.io/tag/PK-1/tok';
    expect(parseQRPayload(raw)).toBeNull();
  });
});

describe('aggregateScanResults', () => {
  it('separates matched vs unmatched payloads', () => {
    const payloads = [
      { shortCode: 'PK-1', sku: 'FRAME-001' },
      { shortCode: 'PK-2', sku: 'UNKNOWN-SKU' },
      { shortCode: 'PK-3', sku: 'WHEEL-26' },
    ];
    const orderSkus = ['FRAME-001', 'WHEEL-26'];

    const { matched, unmatched } = aggregateScanResults(payloads, orderSkus);

    expect(matched.size).toBe(2);
    expect(matched.get('FRAME-001')?.has('PK-1')).toBe(true);
    expect(matched.get('WHEEL-26')?.has('PK-3')).toBe(true);
    expect(unmatched).toEqual([{ shortCode: 'PK-2', sku: 'UNKNOWN-SKU' }]);
  });

  it('deduplicates by shortCode within the same SKU', () => {
    const payloads = [
      { shortCode: 'PK-1', sku: 'FRAME-001' },
      { shortCode: 'PK-1', sku: 'FRAME-001' },
      { shortCode: 'PK-2', sku: 'FRAME-001' },
    ];
    const orderSkus = ['FRAME-001'];

    const { matched } = aggregateScanResults(payloads, orderSkus);

    const codes = matched.get('FRAME-001')!;
    expect(codes.size).toBe(2);
    expect(codes.has('PK-1')).toBe(true);
    expect(codes.has('PK-2')).toBe(true);
  });

  it('matches SKUs case-insensitively', () => {
    const payloads = [
      { shortCode: 'PK-1', sku: 'frame-001' },
      { shortCode: 'PK-2', sku: 'FRAME-001' },
    ];
    const orderSkus = ['Frame-001'];

    const { matched, unmatched } = aggregateScanResults(payloads, orderSkus);

    expect(unmatched).toHaveLength(0);
    // Both match — stored under their original casing
    expect(matched.get('frame-001')?.has('PK-1')).toBe(true);
    expect(matched.get('FRAME-001')?.has('PK-2')).toBe(true);
  });
});
