import { describe, it, expect } from 'vitest';
import {
  buildCartonCoverage,
  coveringCarton,
  fedexCartonGap,
  fedexCartonState,
  sidesToColumns,
  toAscii,
  type FedexCartonRow,
  type MeasuredCartonRow,
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

describe('carton coverage — one record per model + size, no SKU in the file', () => {
  const measured = (over: Partial<MeasuredCartonRow> = {}): MeasuredCartonRow => ({
    sku: '03-3922BL',
    model: 'CODA S2',
    size: '15',
    length_in: 53.75,
    width_in: 9,
    height_in: 29,
    dimensions_verified: true,
    dimensions_measured_at: '2026-08-20T12:00:00Z',
    weight_lbs: 33.6,
    weight_verified: true,
    ...over,
  });
  const black = { sku: '03-3921BK', model: 'CODA S2', size: '15' };

  it('covers a colour whose twin was measured', () => {
    const index = buildCartonCoverage([measured()]);
    const twin = coveringCarton(black, index);
    expect(twin?.skus).toEqual(['03-3922BL']);
    expect(twin?.length_in).toBe(53.75);
    expect(twin?.weight_lbs).toBe(33.6);
  });

  it('does not cover another size of the same model', () => {
    // 27 of 47 models with two measured sizes differ by more than an inch; a
    // bigger frame is a bigger box, and a carton declared too small is the one
    // that gets back-billed.
    const index = buildCartonCoverage([measured()]);
    expect(coveringCarton({ ...black, size: '23' }, index)).toBeNull();
  });

  it('reads the size the way the export writes it, so 56 and 56cm are one group', () => {
    const index = buildCartonCoverage([measured({ size: '56cm', sku: '03-3957GN' })]);
    expect(
      coveringCarton({ sku: '03-3958GY', model: 'CODA S2', size: '56' }, index)
    ).not.toBeNull();
  });

  it('never covers a SKU with itself', () => {
    const index = buildCartonCoverage([measured({ sku: '03-3921BK', model: 'CODA S2' })]);
    expect(coveringCarton(black, index)).toBeNull();
  });

  it('takes the largest of every axis, like the export does', () => {
    const index = buildCartonCoverage([
      measured({ sku: '03-3922BL', length_in: 53.75, width_in: 9, height_in: 29 }),
      measured({ sku: '03-3923GY', length_in: 54.5, width_in: 8.75, height_in: 29.5 }),
    ]);
    const twin = coveringCarton(black, index);
    expect(twin).toMatchObject({ length_in: 54.5, width_in: 9, height_in: 29.5 });
    expect(twin?.skus).toEqual(['03-3922BL', '03-3923GY']);
  });

  it('carries the most recent measurement, so the export state is the group is', () => {
    const index = buildCartonCoverage([
      measured({ sku: '03-3922BL', dimensions_measured_at: '2026-08-20T12:00:00Z' }),
      measured({ sku: '03-3923GY', dimensions_measured_at: '2026-09-09T12:00:00Z' }),
    ]);
    expect(coveringCarton(black, index)?.dimensions_measured_at).toBe('2026-09-09T12:00:00Z');
  });

  it('ignores a twin the export would hold back anyway', () => {
    // Unmeasured, no model, and a lost decimal: none of them is in the file, so
    // none of them covers anything.
    const index = buildCartonCoverage([
      measured({ sku: '03-1000BL', dimensions_verified: false }),
      measured({ sku: '03-1001BL', model: null }),
      measured({ sku: '03-1002BL', width_in: 875 }),
    ]);
    expect(index.groups.size).toBe(0);
  });

  it('takes a weight only from a scale, and the heaviest of them', () => {
    const index = buildCartonCoverage([
      measured({ sku: '03-3922BL', weight_lbs: 33.6, weight_verified: true }),
      measured({ sku: '03-3923GY', weight_lbs: 45, weight_verified: false }),
      measured({ sku: '03-3924RD', weight_lbs: 34.2, weight_verified: true }),
    ]);
    expect(coveringCarton(black, index)?.weight_lbs).toBe(34.2);
  });

  it('has nothing to say about a row with no model', () => {
    const index = buildCartonCoverage([measured()]);
    expect(coveringCarton({ sku: '07-3742BK', model: null, size: null }, index)).toBeNull();
  });
});

describe('a group the export drops covers nothing', () => {
  const at = (sku: string, l: number, w: number, h: number): MeasuredCartonRow => ({
    sku,
    model: 'ALLEGRO A2',
    size: '15',
    length_in: l,
    width_in: w,
    height_in: h,
    dimensions_verified: true,
    dimensions_measured_at: '2026-08-20T12:00:00Z',
    weight_lbs: null,
    weight_verified: false,
  });

  it('two colours more than an inch apart are a conflict, not a carton', () => {
    // 03-3885BK and 03-4536BL, in prod: 29 and 31 once ceiled on the middle
    // axis. buildFedexDimensions drops both, so the file has no ALLEGRO A2 15
    // and the grey one still has to be measured.
    const index = buildCartonCoverage([
      at('03-3885BK', 54.5, 8.25, 29),
      at('03-4536BL', 55, 8.25, 30.25),
    ]);
    expect(index.groups.get([...index.groups.keys()][0])?.conflicted).toBe(true);
    expect(coveringCarton({ sku: '03-4537GY', model: 'ALLEGRO A2', size: '15' }, index)).toBeNull();
  });

  it('within an inch is one carton, which is what the export merges', () => {
    const index = buildCartonCoverage([
      at('03-3885BK', 54.5, 8.25, 29),
      at('03-4536BL', 55, 8.25, 29.5),
    ]);
    expect(
      coveringCarton({ sku: '03-4537GY', model: 'ALLEGRO A2', size: '15' }, index)
    ).not.toBeNull();
  });
});

describe('a size nobody filled in is not a size', () => {
  const divide = (sku: string, size: string | null, length: number): MeasuredCartonRow => ({
    sku,
    model: 'DIVIDE',
    size,
    length_in: length,
    width_in: 9,
    height_in: 31,
    dimensions_verified: true,
    dimensions_measured_at: '2026-08-20T12:00:00Z',
    weight_lbs: null,
    weight_verified: false,
  });

  it('does not let one blank-size row cover another of a model that has sizes', () => {
    // DIVIDE spans seven inches across its sizes (13X27 at 56, 19X29 at 61), so
    // two rows whose size nobody entered are not the same box just because the
    // column is empty on both.
    const index = buildCartonCoverage([
      divide('03-3770BL', '19X29', 61),
      divide('03-3779RD', null, 61),
    ]);
    expect(coveringCarton({ sku: '03-3780BL', model: 'DIVIDE', size: null }, index)).toBeNull();
  });

  it('still covers a model the catalog writes no size for', () => {
    // JUV CAPRI 2.4: one frame, nothing to write in the column, both colours on
    // the same 48 x 26 x 9.
    const capri = (sku: string): MeasuredCartonRow => ({
      ...divide(sku, null, 48),
      model: 'JUV CAPRI 2.4',
    });
    const index = buildCartonCoverage([capri('07-3689WH'), capri('07-3690BL')]);
    expect(
      coveringCarton({ sku: '07-3691GY', model: 'JUV CAPRI 2.4', size: null }, index)?.skus
    ).toEqual(['07-3689WH', '07-3690BL']);
  });

  it('learns that a model has sizes from a row nobody measured', () => {
    const index = buildCartonCoverage([
      divide('03-3770BL', null, 61),
      { ...divide('03-3771BL', '13X27', 56), dimensions_verified: false },
    ]);
    expect(coveringCarton({ sku: '03-3779RD', model: 'DIVIDE', size: null }, index)).toBeNull();
  });
});
