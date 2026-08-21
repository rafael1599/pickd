import { describe, it, expect } from 'vitest';
import {
  fedexCartonGap,
  fedexCartonState,
  sidesToColumns,
  toAscii,
  type FedexCartonRow,
} from '../fedexCarton';

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

describe('sidesToColumns', () => {
  it('puts the longest in length, the thinnest in width, the middle in height', () => {
    expect(sidesToColumns([54, 8, 30])).toEqual({ length_in: 54, width_in: 8, height_in: 30 });
  });

  it('gives the same answer for every order the sides can be read in', () => {
    const expected = { length_in: 54, width_in: 8, height_in: 30 };
    for (const sides of [
      [54, 8, 30],
      [54, 30, 8],
      [8, 54, 30],
      [8, 30, 54],
      [30, 54, 8],
      [30, 8, 54],
    ] as [number, number, number][]) {
      expect(sidesToColumns(sides)).toEqual(expected);
    }
  });

  it('always produces a carton the export accepts', () => {
    // Sorting is what makes implausible_dimensions structurally impossible on
    // this path, which is why the form stopped asking for a particular order.
    for (const sides of [
      [8, 30, 54],
      [17, 8, 30],
      [24, 48, 8],
      [30.5, 8.5, 55],
    ] as [number, number, number][]) {
      expect(
        fedexCartonGap({ model: 'X', ...sidesToColumns(sides), dimensions_verified: true })
      ).toBeNull();
    }
  });
});

describe('fedexCartonState', () => {
  const measured = (at: string | null): Parameters<typeof fedexCartonState>[0] => ({
    model: 'ALLEGRO A3',
    length_in: 54,
    width_in: 8,
    height_in: 30,
    dimensions_verified: true,
    dimensions_measured_at: at,
  });

  it('is unmeasured when the carton cannot be exported at all', () => {
    expect(
      fedexCartonState({ ...measured('2026-08-01T00:00:00Z'), dimensions_verified: false }, null)
    ).toBe('unmeasured');
    expect(fedexCartonState({ ...measured('2026-08-01T00:00:00Z'), model: null }, null)).toBe(
      'unmeasured'
    );
  });

  it('is unmeasured when it is verified but carries no timestamp', () => {
    // Pre-backfill rows. Warning rather than assuming FedEx has it is the safe
    // direction: it costs a second look, not a re-billed shipment.
    expect(fedexCartonState(measured(null), '2026-08-20T20:22:29Z')).toBe('unmeasured');
  });

  it('is synced when the measurement predates the last export', () => {
    expect(fedexCartonState(measured('2026-08-19T10:00:00Z'), '2026-08-20T20:22:29Z')).toBe(
      'synced'
    );
  });

  it('counts a same-instant stamp as carried', () => {
    expect(fedexCartonState(measured('2026-08-20T20:22:29Z'), '2026-08-20T20:22:29Z')).toBe(
      'synced'
    );
  });

  it('is pending when the box was measured after the last export', () => {
    // The real case: 20260821120000 corrected 33 cartons forty minutes after
    // the export that was live at the time.
    expect(fedexCartonState(measured('2026-08-21T16:41:00Z'), '2026-08-21T16:02:47Z')).toBe(
      'pending_export'
    );
  });

  it('is pending when no export has ever run', () => {
    expect(fedexCartonState(measured('2026-08-21T16:41:00Z'), null)).toBe('pending_export');
  });

  it('is pending rather than synced when a timestamp is unreadable', () => {
    expect(fedexCartonState(measured('not a date'), '2026-08-20T20:22:29Z')).toBe('pending_export');
  });
});
