import { describe, it, expect } from 'vitest';
import {
  buildFedexDimensions,
  fedexDimensionsFilename,
  renderSize,
  toFsmCsv,
  type DimensionSourceRow,
} from '../fedexDimensions';

/**
 * Dimensions below are written the way Pickd stores them:
 * length_in = longest, height_in = middle (~30), width_in = thinnest (8–13).
 */
const row = (over: Partial<DimensionSourceRow> & { sku: string }): DimensionSourceRow => ({
  model: 'ALLEGRO A3',
  size: '15',
  length_in: 53.75,
  width_in: 8,
  height_in: 30.25,
  dimensions_verified: true,
  ...over,
});

describe('renderSize', () => {
  it('marks frame sizes in inches', () => {
    expect(renderSize('15')).toBe("15''");
    expect(renderSize('23')).toBe("23''");
  });

  it('leaves road sizes in centimetres bare', () => {
    expect(renderSize('51')).toBe('51');
    expect(renderSize('61')).toBe('61');
  });

  it('keeps the low-step L prefix', () => {
    expect(renderSize('L16')).toBe("L16''");
    expect(renderSize('L54')).toBe('L54');
  });

  it('keeps both halves of a wheel-by-frame size', () => {
    expect(renderSize('27.5X14')).toBe("27.5''X14");
    expect(renderSize('14X27')).toBe("14''X27");
  });

  it('handles the 700C wheel sizes', () => {
    expect(renderSize('700C')).toBe('700C');
    expect(renderSize('700CX16')).toBe("700CX16''");
  });

  it('strips inch marks and spaces that came from the catalog', () => {
    expect(renderSize(' 19" ')).toBe("19''");
    expect(renderSize('58 cm')).toBe('58');
  });

  it('returns null for nothing', () => {
    expect(renderSize(null)).toBeNull();
    expect(renderSize('')).toBeNull();
  });

  it('never emits a double quote', () => {
    const all = ['15', '51', 'L16', '27.5X14', '700CX16', '19"'];
    for (const s of all) expect(renderSize(s)).not.toContain('"');
  });
});

describe('buildFedexDimensions — axes', () => {
  it('maps Length from length_in, Width from height_in and Height from width_in', () => {
    const { records } = buildFedexDimensions([
      row({ sku: '03-4805RD', length_in: 53.75, width_in: 8, height_in: 30.25 }),
    ]);
    expect(records).toHaveLength(1);
    expect(records[0].length).toBe(54); // longest
    expect(records[0].width).toBe(31); // middle
    expect(records[0].height).toBe(8); // thinnest
  });

  it('rounds every dimension up', () => {
    const { records } = buildFedexDimensions([
      row({ sku: 'A', length_in: 53.01, width_in: 8.01, height_in: 30.01 }),
    ]);
    expect(records[0]).toMatchObject({ length: 54, width: 31, height: 9 });
  });
});

describe('buildFedexDimensions — grouping', () => {
  it('merges sizes of one model that share a carton', () => {
    const { records } = buildFedexDimensions([
      row({ sku: 'A', size: '15', length_in: 54, width_in: 8, height_in: 30 }),
      row({ sku: 'B', size: '17', length_in: 54, width_in: 8, height_in: 30 }),
      row({ sku: 'C', size: '19', length_in: 54, width_in: 8, height_in: 30 }),
    ]);
    expect(records).toHaveLength(1);
    expect(records[0].description).toBe("ALLEGRO A3 15''-19''");
    expect(records[0].skus).toEqual(['A', 'B', 'C']);
  });

  it('splits one model across cartons that differ', () => {
    const { records } = buildFedexDimensions([
      row({ sku: 'A', size: '15', length_in: 54, width_in: 8, height_in: 30 }),
      row({ sku: 'B', size: '23', length_in: 56, width_in: 8, height_in: 30 }),
    ]);
    expect(records).toHaveLength(2);
    expect(records.map((r) => r.description)).toEqual(["ALLEGRO A3 15''", "ALLEGRO A3 23''"]);
  });

  it('never merges across models even when the carton is identical', () => {
    const { records } = buildFedexDimensions([
      row({ sku: 'A', model: 'ALLEGRO A3', size: '15' }),
      row({ sku: 'B', model: 'DXT A2', size: '15' }),
    ]);
    expect(records).toHaveLength(2);
    expect(records.map((r) => r.id)).toEqual(['ALLEGROA315', 'DXTA215']);
  });

  it('takes the largest value per axis when colours of one size disagree', () => {
    // 8.25 and 8.00 round to 9 and 8; the bigger carton is the safe one to declare.
    const { records } = buildFedexDimensions([
      row({ sku: 'RD', size: '17', length_in: 54, width_in: 8.25, height_in: 30.25 }),
      row({ sku: 'BK', size: '17', length_in: 54, width_in: 8, height_in: 30.5 }),
    ]);
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ length: 54, width: 31, height: 9 });
    expect(records[0].skus).toEqual(['BK', 'RD']);
  });

  it('orders a size span numerically, not alphabetically', () => {
    const { records } = buildFedexDimensions([
      row({ sku: 'A', size: '9', length_in: 54, width_in: 8, height_in: 30 }),
      row({ sku: 'B', size: '23', length_in: 54, width_in: 8, height_in: 30 }),
    ]);
    expect(records[0].description).toBe("ALLEGRO A3 9''-23''");
  });

  it('describes a sizeless model by its name alone', () => {
    const { records } = buildFedexDimensions([
      row({ sku: '07-3529BL', model: 'JAMIS HOT ROD', size: null }),
    ]);
    expect(records[0].description).toBe('JAMIS HOT ROD');
    expect(records[0].id).toBe('JAMISHOTROD');
  });
});

describe('buildFedexDimensions — exceptions', () => {
  it('excludes unverified rows and says why', () => {
    const { records, exceptions } = buildFedexDimensions([
      row({ sku: 'GOOD' }),
      row({ sku: 'BAD', dimensions_verified: false }),
    ]);
    expect(records.flatMap((r) => r.skus)).toEqual(['GOOD']);
    expect(exceptions).toEqual([
      expect.objectContaining({ sku: 'BAD', reason: 'unverified' }),
    ]);
  });

  it('excludes a measured row that has no model to name it', () => {
    const { records, exceptions } = buildFedexDimensions([row({ sku: '07-3606GP', model: null })]);
    expect(records).toHaveLength(0);
    expect(exceptions[0]).toMatchObject({ sku: '07-3606GP', reason: 'no_model' });
  });

  it('excludes a dimension too large for the three-character field', () => {
    const { records, exceptions } = buildFedexDimensions([row({ sku: 'X', width_in: 1200 })]);
    expect(records).toHaveLength(0);
    expect(exceptions[0]).toMatchObject({ sku: 'X', reason: 'unusable_dimensions' });
  });

  it('excludes a lost decimal that still fits the field', () => {
    // 03-4046MN sat at width_in 875 for 8.75. It is three characters, so the
    // field-width check passes it; only the side ordering catches it.
    const { records, exceptions } = buildFedexDimensions([row({ sku: '03-4046MN', width_in: 875 })]);
    expect(records).toHaveLength(0);
    expect(exceptions[0]).toMatchObject({ sku: '03-4046MN', reason: 'implausible_dimensions' });
  });

  it('excludes a row missing a dimension', () => {
    const { exceptions } = buildFedexDimensions([row({ sku: 'X', height_in: null })]);
    expect(exceptions[0]).toMatchObject({ sku: 'X', reason: 'unusable_dimensions' });
  });

  it('keeps small but real cartons — kids bikes and framekits are not errors', () => {
    const { records, exceptions } = buildFedexDimensions([
      row({ sku: '07-3529BL', model: 'JAMIS HOT ROD', size: null, length_in: 30, width_in: 8, height_in: 17 }),
      row({ sku: '09-4828CL', model: 'RENEGADE S1 UDH FRAMEKIT', size: '56', length_in: 48, width_in: 8, height_in: 24 }),
    ]);
    expect(exceptions).toHaveLength(0);
    expect(records).toHaveLength(2);
  });
});

describe('buildFedexDimensions — identifiers', () => {
  it('builds an uppercase alphanumeric id from model and sizes', () => {
    const { records } = buildFedexDimensions([
      row({ sku: 'A', model: 'ALLEGRO A3', size: '19', length_in: 54, width_in: 8, height_in: 30 }),
      row({ sku: 'B', model: 'ALLEGRO A3', size: '21', length_in: 54, width_in: 8, height_in: 30 }),
    ]);
    expect(records[0].id).toBe('ALLEGROA31921');
    expect(records[0].id).toMatch(/^[A-Z0-9]+$/);
  });

  it('keeps ids within 30 characters', () => {
    const { records } = buildFedexDimensions([
      row({ sku: 'A', model: 'RENEGADE C3 APEX EAGLE AXS SUPER LONG NAME', size: '58' }),
    ]);
    expect(records[0].id.length).toBeLessThanOrEqual(30);
  });

  it('gives colliding ids distinct values', () => {
    const { records } = buildFedexDimensions([
      row({ sku: 'A', model: 'RENEGADE C3 APEX EAGLE AXS VARIANT ONE', size: '58' }),
      row({ sku: 'B', model: 'RENEGADE C3 APEX EAGLE AXS VARIANT TWO', size: '58' }),
    ]);
    const ids = records.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('toFsmCsv', () => {
  const built = buildFedexDimensions([
    row({ sku: 'A', model: 'ALLEGRO A3', size: '19', length_in: 54.75, width_in: 8.25, height_in: 30.5 }),
    row({ sku: 'B', model: 'ALLEGRO A3', size: '21', length_in: 54.5, width_in: 8.5, height_in: 30.75 }),
  ]);

  it('writes Description, ID, Height, Length, Width with every field quoted', () => {
    expect(toFsmCsv(built.records)).toBe('"ALLEGRO A3 19\'\'-21\'\'","ALLEGROA31921","9","55","31"\r\n');
  });

  it('uses CRLF and no header row', () => {
    const csv = toFsmCsv(built.records);
    expect(csv.startsWith('"')).toBe(true);
    expect(csv).not.toContain('Description,');
    expect(csv.endsWith('\r\n')).toBe(true);
  });

  it('emits one line per record', () => {
    const many = buildFedexDimensions([
      row({ sku: 'A', size: '15', length_in: 54, width_in: 8, height_in: 30 }),
      row({ sku: 'B', size: '23', length_in: 56, width_in: 8, height_in: 30 }),
    ]);
    expect(toFsmCsv(many.records).split('\r\n').filter(Boolean)).toHaveLength(2);
  });

  it('is empty for no records rather than a stray newline', () => {
    expect(toFsmCsv([])).toBe('');
  });

  it('contains no ASCII double quote inside the data', () => {
    const csv = toFsmCsv(built.records);
    for (const line of csv.trim().split('\r\n')) {
      for (const field of line.split('","')) {
        expect(field.replace(/^"|"$/g, '')).not.toContain('"');
      }
    }
  });
});

describe('determinism', () => {
  it('produces an identical file from the same rows in any input order', () => {
    const rows = [
      row({ sku: 'C', model: 'DXT A2', size: '17', length_in: 56.5, width_in: 8.75, height_in: 31.75 }),
      row({ sku: 'A', model: 'ALLEGRO A3', size: '15' }),
      row({ sku: 'B', model: 'ALLEGRO A3', size: '17' }),
    ];
    const first = toFsmCsv(buildFedexDimensions(rows).records);
    const shuffled = toFsmCsv(buildFedexDimensions([...rows].reverse()).records);
    expect(shuffled).toBe(first);
  });
});

describe('fedexDimensionsFilename', () => {
  it('is dated YYYYMMDD', () => {
    expect(fedexDimensionsFilename(new Date(2026, 7, 20))).toBe('DIMENSIONS_FEDEX_20260820.csv');
  });

  it('pads single-digit months and days', () => {
    expect(fedexDimensionsFilename(new Date(2026, 0, 5))).toBe('DIMENSIONS_FEDEX_20260105.csv');
  });
});
