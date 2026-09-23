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

  // The low-step frame sizes. `renderSize` in the FedEx export already knew how
  // to format these; this is the half that had to learn to read them.
  it('parses a low-step L size', () => {
    const r = parseBikeName('CODA S2 L16 2026 GLOSS BLACK');
    expect(r.model).toBe('CODA S2');
    expect(r.size).toBe('L16');
    expect(r.year).toBe('2026');
    expect(r.color).toBe('GLOSS BLACK');
  });

  it('parses a two-digit L size', () => {
    const r = parseBikeName('VENTURA A2 L48 2026 BLUE VAPOR');
    expect(r.model).toBe('VENTURA A2');
    expect(r.size).toBe('L48');
    expect(r.color).toBe('BLUE VAPOR');
  });

  // Everything below stays a fallback ON PURPOSE. Each one is a shape a human
  // types by hand, because guessing lands in `model`/`size` — the FedEx
  // Dimensions grouping key — and a wrong box ships from the warehouse.
  it('refuses a compound size rather than guessing which half is the wheel', () => {
    // AS400 writes frame X wheel; the rows stored in sku_metadata are wheel X
    // frame (27.5X19, 700CX16). Splitting this would invert the two.
    const r = parseBikeName('DIVIDE 13X27 2025 GLOSS BLACK');
    expect(r.size).toBe('');
    expect(r.model).toBe('DIVIDE 13X27 2025 GLOSS BLACK');
  });

  it('refuses a bare-letter size', () => {
    expect(parseBikeName('KROMO L 2026 MASH').size).toBe('');
  });

  it('refuses centimetres', () => {
    expect(parseBikeName('RENEGADE A1 LTD 54CM 2025 MASH').size).toBe('');
  });

  it('falls back when the bike has no frame size at all', () => {
    // A trike has none, so there is nothing to split. Not a failure.
    const r = parseBikeName('TAXI TRIKE 2026 GLOSS BLACK');
    expect(r.size).toBe('');
    expect(r.model).toBe('TAXI TRIKE 2026 GLOSS BLACK');
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

describe('parseBikeName - yearless and marked sizes', () => {
  it('parses marked size without year', () => {
    const r = parseBikeName('Explorer A2 19" Gloss Black');
    expect(r.model).toBe('Explorer A2');
    expect(r.size).toBe('19"');
    expect(r.color).toBe('Gloss Black');
    expect(r.year).toBe('');
  });

  it('parses cm size without year', () => {
    const r = parseBikeName('Renegade S3 56cm Monterey Grey');
    expect(r.model).toBe('Renegade S3');
    expect(r.size).toBe('56cm');
    expect(r.color).toBe('Monterey Grey');
    expect(r.year).toBe('');
  });

  it('parses size when bare numbers are before it as part of model', () => {
    const r = parseBikeName('Citizen 2 17" Storm Grey');
    expect(r.model).toBe('Citizen 2');
    expect(r.size).toBe('17"');
    expect(r.color).toBe('Storm Grey');
    expect(r.year).toBe('');
  });

  it('does not split a compound — the axes would invert (Rafael, 2026-09-02)', () => {
    expect(parseBikeName('Some Bike 27.5X16 Gloss Black').size).toBe('');
    expect(parseBikeName('Some Bike 13X27 Gloss Black').size).toBe('');
  });

  it('parses 700c wheel sizes', () => {
    const r = parseBikeName('Some Bike 700C x 54cm Blue');
    expect(r.model).toBe('Some Bike');
    expect(r.size).toBe('700C x 54cm');
    expect(r.color).toBe('Blue');
    expect(r.year).toBe('');
  });

  it('leaves a bare number without year as part of model (no parsing)', () => {
    const r = parseBikeName('Citizen 19 Sahara Silver');
    expect(r.model).toBe('Citizen 19 Sahara Silver');
    expect(r.size).toBe('');
    expect(r.color).toBe('');
    expect(r.year).toBe('');
  });

  it('a number outside the frame range is not a frame size', () => {
    // 7.75" on a build kit is fork travel: a wrong split here lands in the FedEx key.
    expect(parseBikeName('Build Kit Portal C4 7.75" Fox 34 Rhythm').size).toBe('');
    expect(parseBikeName('Boss Crusier 7 18" Raspberry')).toMatchObject({
      model: 'Boss Crusier 7',
      size: '18"',
      color: 'Raspberry',
    });
    expect(parseBikeName('Earth Crusier 3 ST 17" Gloss Black').model).toBe('Earth Crusier 3 ST');
    expect(parseBikeName('Allegro A3 ST L14 Sugar Mint').size).toBe('L14');
  });
});
