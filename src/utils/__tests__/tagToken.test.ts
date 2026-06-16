import { describe, it, expect } from 'vitest';
import { encodeTagToken, decodeTagToken, normalizeTagToken } from '../tagToken';

const UUID = '7f3e4d2a-1b2c-4d5e-8f90-1a2b3c4d5e6f';

describe('tagToken', () => {
  it('encodes a UUID to a 22-char base64url token', () => {
    const t = encodeTagToken(UUID);
    expect(t).toHaveLength(22);
    expect(t).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(t).not.toContain('='); // no padding
  });

  it('round-trips encode → decode back to the same UUID', () => {
    expect(decodeTagToken(encodeTagToken(UUID))).toBe(UUID);
  });

  it('is meaningfully shorter than the raw UUID', () => {
    expect(encodeTagToken(UUID).length).toBeLessThan(UUID.length); // 22 < 36
  });

  it('normalize accepts the compact form (decodes to UUID)', () => {
    expect(normalizeTagToken(encodeTagToken(UUID))).toBe(UUID);
  });

  it('normalize accepts a legacy raw UUID unchanged (lowercased)', () => {
    expect(normalizeTagToken(UUID)).toBe(UUID);
    expect(normalizeTagToken(UUID.toUpperCase())).toBe(UUID);
  });

  it('encode leaves a non-UUID input untouched', () => {
    expect(encodeTagToken('not-a-uuid')).toBe('not-a-uuid');
  });

  it('round-trips across many random UUIDs', () => {
    for (let i = 0; i < 50; i++) {
      const uuid = crypto.randomUUID();
      expect(decodeTagToken(encodeTagToken(uuid))).toBe(uuid);
      expect(normalizeTagToken(encodeTagToken(uuid))).toBe(uuid);
    }
  });
});
