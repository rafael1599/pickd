import { describe, it, expect } from 'vitest';
import { fedexCartonGap, toAscii, type FedexCartonRow } from '../fedexCarton';

/** A carton that passes every check, so each test can break exactly one thing. */
const good = (over: Partial<FedexCartonRow> = {}): FedexCartonRow => ({
  model: 'ALLEGRO A3',
  length_in: 54,
  width_in: 8,
  height_in: 30,
  dimensions_verified: true,
  ...over,
});

describe('fedexCartonGap', () => {
  it('passes a measured carton', () => {
    expect(fedexCartonGap(good())).toBeNull();
  });

  it('holds back a carton nobody measured, whatever the numbers say', () => {
    // The trigger's own default is a plausible-looking bike box; the flag is
    // the only thing separating it from a real measurement.
    expect(fedexCartonGap(good({ dimensions_verified: false }))).toBe('unverified');
    expect(
      fedexCartonGap({
        model: 'ALLEGRO A3',
        length_in: 55,
        width_in: 8.5,
        height_in: 30.5,
        dimensions_verified: false,
      })
    ).toBe('unverified');
  });

  it('holds back a measured carton with no model to name it after', () => {
    expect(fedexCartonGap(good({ model: null }))).toBe('no_model');
    expect(fedexCartonGap(good({ model: '   ' }))).toBe('no_model');
    // Non-ASCII only: survives trim(), does not survive the format.
    expect(fedexCartonGap(good({ model: '★★' }))).toBe('no_model');
  });

  it('holds back a missing dimension', () => {
    expect(fedexCartonGap(good({ width_in: null }))).toBe('unusable_dimensions');
    expect(fedexCartonGap(good({ length_in: null }))).toBe('unusable_dimensions');
  });

  it('holds back a zero and a value too wide for the 3-character field', () => {
    expect(fedexCartonGap(good({ width_in: 0 }))).toBe('unusable_dimensions');
    expect(fedexCartonGap(good({ length_in: 1000 }))).toBe('unusable_dimensions');
    expect(fedexCartonGap(good({ length_in: 999 }))).toBeNull();
  });

  it('catches the lost decimal that the field-width check lets through', () => {
    // 03-4046MN: width_in 875 for 8.75. Three characters, so length alone
    // cannot tell it apart from a real number — the side ordering can.
    expect(fedexCartonGap(good({ width_in: 875 }))).toBe('implausible_dimensions');
  });

  it('keeps genuinely small cartons, because the rule uses no threshold', () => {
    // Hot Rod 30/17/8 and a framekit 48/24/8, in Pickd's column order
    // (longest / thinnest / middle).
    expect(fedexCartonGap(good({ length_in: 30, width_in: 8, height_in: 17 }))).toBeNull();
    expect(fedexCartonGap(good({ length_in: 48, width_in: 8, height_in: 24 }))).toBeNull();
  });

  it('reads height_in as the middle side and width_in as the thinnest', () => {
    // Swapping the two columns breaks the ordering, which is the whole point:
    // a file built the other way round imports cleanly and misrates everything.
    expect(fedexCartonGap(good({ width_in: 30, height_in: 8 }))).toBe('implausible_dimensions');
  });

  it('rounds up before checking, so the test is on the declared carton', () => {
    // A middle fractionally longer than the longest still ceils to the same
    // whole inch, and equal sides order fine — 30.2 and 30.6 are both 31.
    expect(fedexCartonGap(good({ length_in: 30.2, width_in: 8, height_in: 30.6 }))).toBeNull();
    // It only fails once the middle rounds to a larger inch than the longest.
    expect(fedexCartonGap(good({ length_in: 30.2, width_in: 8, height_in: 31.1 }))).toBe(
      'implausible_dimensions'
    );
  });

  it('reports the first problem, not all of them', () => {
    // Unverified wins over a bad model: measuring it is the first move either way.
    expect(fedexCartonGap(good({ dimensions_verified: false, model: null }))).toBe('unverified');
  });
});

describe('toAscii', () => {
  it('replaces the quotes the format forbids', () => {
    expect(toAscii('DXT A3 19\u201D SMOKE')).toBe("DXT A3 19' SMOKE");
    expect(toAscii('L14\u201D LOW STEP')).toBe("L14' LOW STEP");
  });

  it('drops non-ASCII and collapses whitespace', () => {
    expect(toAscii('  HUDSON   E2  ')).toBe('HUDSON E2');
    expect(toAscii('CITIZEN 3\u2013S/T')).toBe('CITIZEN 3S/T');
  });
});
