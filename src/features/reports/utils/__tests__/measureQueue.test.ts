import { describe, it, expect } from 'vitest';
import {
  toMeasureQueue,
  formatAddress,
  describeBike,
  matchesQuery,
  splitByCoverage,
  type BikeDemandRow,
} from '../measureQueue';
import { buildCartonCoverage, type MeasuredCartonRow } from '../../../../utils/fedexCarton';

/** A measured, exportable carton. Overrides make the interesting cases. */
const row = (over: Partial<BikeDemandRow> = {}): BikeDemandRow => ({
  sku: '03-3981GY',
  model: 'CITIZEN 2 19 STORM',
  size: null,
  image_url: null,
  length_in: 55,
  width_in: 8.75,
  height_in: 29,
  weight_lbs: 45,
  weight_verified: false,
  dimensions_verified: true,
  dimensions_measured_at: '2026-08-21T12:00:00Z',
  orders: 90,
  units: 131,
  last_ordered: '2026-09-01T00:00:00Z',
  stock: 149,
  location: 'ROW 43',
  sublocation: ['B'],
  ...over,
});

describe('toMeasureQueue', () => {
  it('keeps only the bikes FedEx has no usable carton for', () => {
    const queue = toMeasureQueue([
      row({ sku: 'MEASURED' }),
      row({ sku: 'NEVER-MEASURED', dimensions_verified: false }),
    ]);
    expect(queue.map((e) => e.sku)).toEqual(['NEVER-MEASURED']);
    expect(queue[0].gap).toBe('unverified');
  });

  it('keeps a verified row whose sides cannot be a carton', () => {
    // 03-4046MN sat at width_in 875 for 8.75. Three characters, so the field
    // width check passes it straight through to FedEx.
    const queue = toMeasureQueue([row({ sku: '03-4046MN', width_in: 875 })]);
    expect(queue).toHaveLength(1);
    expect(queue[0].gap).toBe('implausible_dimensions');
  });

  it('keeps a measured row with no model to name the record after', () => {
    const queue = toMeasureQueue([row({ model: null })]);
    expect(queue[0].gap).toBe('no_model');
  });

  it('preserves the ranking the RPC returned and numbers it from one', () => {
    const queue = toMeasureQueue([
      row({ sku: 'A', orders: 90, dimensions_verified: false }),
      row({ sku: 'SKIPPED' }),
      row({ sku: 'B', orders: 53, dimensions_verified: false }),
      row({ sku: 'C', orders: 50, dimensions_verified: false }),
    ]);
    expect(queue.map((e) => [e.sku, e.rank])).toEqual([
      ['A', 1],
      ['B', 2],
      ['C', 3],
    ]);
  });

  it('is empty when everything on hand is already rated', () => {
    expect(toMeasureQueue([row(), row({ sku: 'OTHER' })])).toEqual([]);
  });
});

describe('formatAddress', () => {
  it('joins the row and its square', () => {
    expect(formatAddress({ location: 'ROW 30', sublocation: ['H'] })).toBe('ROW 30 · H');
  });

  it('falls back to the row alone when no square is recorded', () => {
    expect(formatAddress({ location: 'ROW 30', sublocation: null })).toBe('ROW 30');
    expect(formatAddress({ location: 'ROW 30', sublocation: [] })).toBe('ROW 30');
  });

  it('is null with no location at all', () => {
    expect(formatAddress({ location: null, sublocation: ['H'] })).toBeNull();
  });
});

describe('describeBike', () => {
  it('joins model and size', () => {
    expect(describeBike({ model: 'EXPLORER A2', size: '19' })).toBe('EXPLORER A2 19');
  });

  it('says so when there is no model, rather than rendering an empty line', () => {
    expect(describeBike({ model: null, size: null })).toBe('no model on the record');
  });
});

describe('matchesQuery', () => {
  const entry = toMeasureQueue([
    row({ sku: '03-3978BL', model: 'CITIZEN 2 17 MONTEREY', location: 'ROW 30', sublocation: ['H'], dimensions_verified: false }),
  ])[0];

  it('matches an empty query', () => {
    expect(matchesQuery(entry, '   ')).toBe(true);
  });

  it('matches on SKU, model and address', () => {
    expect(matchesQuery(entry, '3978')).toBe(true);
    expect(matchesQuery(entry, 'citizen')).toBe(true);
    expect(matchesQuery(entry, 'row 30')).toBe(true);
  });

  it('requires every term, so two words narrow rather than widen', () => {
    expect(matchesQuery(entry, 'citizen 17')).toBe(true);
    expect(matchesQuery(entry, 'citizen 19')).toBe(false);
  });
});

describe('splitByCoverage — the trip that measures nothing', () => {
  const twin = (over: Partial<MeasuredCartonRow> = {}): MeasuredCartonRow => ({
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
  const black = row({ sku: '03-3921BK', model: 'CODA S2', size: '15', dimensions_verified: false });

  it('takes a colour out of the queue when its twin is measured', () => {
    const { queue, covered } = splitByCoverage(
      toMeasureQueue([black]),
      buildCartonCoverage([twin()])
    );
    expect(queue).toEqual([]);
    expect(covered[0].entry.sku).toBe('03-3921BK');
    expect(covered[0].twin.skus).toEqual(['03-3922BL']);
  });

  it('leaves everything in the queue while the index has not loaded', () => {
    const { queue, covered } = splitByCoverage(toMeasureQueue([black]), undefined);
    expect(queue.map((e) => e.sku)).toEqual(['03-3921BK']);
    expect(covered).toEqual([]);
  });

  it('still asks for a row whose own numbers are broken, covered or not', () => {
    // A lost decimal is a defect on this record; the group being in the file is
    // no reason to leave 875 sitting in a column.
    const broken = row({ sku: '03-3921BK', model: 'CODA S2', size: '15', width_in: 875 });
    const { queue, covered } = splitByCoverage(
      toMeasureQueue([broken]),
      buildCartonCoverage([twin()])
    );
    expect(queue.map((e) => e.sku)).toEqual(['03-3921BK']);
    expect(covered).toEqual([]);
  });

  it('does not take a different size out of the queue', () => {
    const other = row({ sku: '03-3929BK', model: 'CODA S2', size: '23', dimensions_verified: false });
    const { queue } = splitByCoverage(toMeasureQueue([other]), buildCartonCoverage([twin()]));
    expect(queue.map((e) => e.sku)).toEqual(['03-3929BK']);
  });
});
