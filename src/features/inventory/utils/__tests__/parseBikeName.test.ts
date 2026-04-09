import { describe, it, expect } from 'vitest';
import { parseBikeName } from '../parseBikeName';

describe('parseBikeName', () => {
  it('parses full model with variant', () => {
    const r = parseBikeName('FAULTLINE A1 V2 15 2026 GLOSS BLACK');
    expect(r.model).toBe('FAULTLINE A1 V2');
    expect(r.size).toBe('15');
    expect(r.year).toBe('2026');
    expect(r.color).toBe('GLOSS BLACK');
  });

  it('parses model without variant', () => {
    const r = parseBikeName('EC1 18 2025 KINETIC GREY');
    expect(r.model).toBe('EC1');
    expect(r.size).toBe('18');
    expect(r.year).toBe('2025');
    expect(r.color).toBe('KINETIC GREY');
  });

  it('parses single-word color', () => {
    const r = parseBikeName('FAULTLINE A1 V2 15 2026 GARNET');
    expect(r.model).toBe('FAULTLINE A1 V2');
    expect(r.color).toBe('GARNET');
  });

  it('parses HELIX variant', () => {
    const r = parseBikeName('HELIX A2 16 2025 SUGAR MINT');
    expect(r.model).toBe('HELIX A2');
    expect(r.size).toBe('16');
    expect(r.year).toBe('2025');
    expect(r.color).toBe('SUGAR MINT');
  });

  it('parses different sizes of same model', () => {
    const r17 = parseBikeName('FAULTLINE A1 V2 17 2026 GLOSS BLACK');
    const r19 = parseBikeName('FAULTLINE A1 V2 19 2026 GLOSS BLACK');
    expect(r17.size).toBe('17');
    expect(r19.size).toBe('19');
    expect(r17.model).toBe(r19.model);
  });

  it('returns raw fallback for empty string', () => {
    const r = parseBikeName('');
    expect(r.model).toBe('');
    expect(r.size).toBe('');
    expect(r.raw).toBe('');
  });

  it('returns raw fallback for null/undefined', () => {
    expect(parseBikeName(null).model).toBe('');
    expect(parseBikeName(undefined).model).toBe('');
  });

  it('returns raw fallback for unparseable names', () => {
    const r = parseBikeName('BRAKE PAD SHIMANO');
    expect(r.model).toBe('BRAKE PAD SHIMANO');
    expect(r.size).toBe('');
    expect(r.year).toBe('');
    expect(r.color).toBe('');
  });

  it('returns raw fallback for short strings', () => {
    const r = parseBikeName('UNKNOWN');
    expect(r.model).toBe('UNKNOWN');
    expect(r.size).toBe('');
  });

  it('preserves raw in all cases', () => {
    const name = 'FAULTLINE A1 V2 15 2026 WHITE';
    expect(parseBikeName(name).raw).toBe(name);
  });
});
