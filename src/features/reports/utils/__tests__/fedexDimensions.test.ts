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
    expect(records[0].description).toBe("ALLEGRO A3, 15''-19''");
    expect(records[0].skus).toEqual(['A', 'B', 'C']);
  });

  it('splits one model across cartons that differ', () => {
    const { records } = buildFedexDimensions([
      row({ sku: 'A', size: '15', length_in: 54, width_in: 8, height_in: 30 }),
      row({ sku: 'B', size: '23', length_in: 56, width_in: 8, height_in: 30 }),
    ]);
    expect(records).toHaveLength(2);
    expect(records.map((r) => r.description)).toEqual(["ALLEGRO A3, 15''", "ALLEGRO A3, 23''"]);
  });

  it('merges across models when the carton is identical', () => {
    const { records } = buildFedexDimensions([
      row({ sku: 'A', model: 'ALLEGRO A3', size: '15' }),
      row({ sku: 'B', model: 'DXT A2', size: '15' }),
    ]);
    expect(records).toHaveLength(1);
    expect(records[0].id).toMatch(/ALLEGROA3/);
    expect(records[0].id).toMatch(/DXTA2/);
    expect(records[0].skus).toEqual(['A', 'B']);
  });

  it('averages readings when colours of one size disagree within an inch', () => {
    // 8.25 and 8.00 average to 8.125, and the ceil takes it back to 9: the
    // declared carton is never under what the average says.
    const { records } = buildFedexDimensions([
      row({ sku: 'RD', size: '17', length_in: 54, width_in: 8.25, height_in: 30.25 }),
      row({ sku: 'BK', size: '17', length_in: 54, width_in: 8, height_in: 30.5 }),
    ]);
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ length: 54, width: 31, height: 9 });
    expect(records[0].skus).toEqual(['BK', 'RD']);
  });

  it('declares the average, not the largest, when two colours straddle an inch', () => {
    // Height comes from width_in: 7.5 and 8.5 average to 8 exactly, where the
    // largest would have declared 9 — a carton neither colour has.
    const { records } = buildFedexDimensions([
      row({ sku: 'RD', size: '17', length_in: 54, width_in: 7.5, height_in: 30 }),
      row({ sku: 'BK', size: '17', length_in: 54, width_in: 8.5, height_in: 30 }),
    ]);
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ length: 54, width: 30, height: 8 });
  });

  it('holds back a group as dimension_conflict if any axis differs by more than an inch', () => {
    const { records, exceptions } = buildFedexDimensions([
      row({ sku: 'RD', size: '17', length_in: 54, width_in: 8, height_in: 30 }),
      row({ sku: 'BK', size: '17', length_in: 56, width_in: 8, height_in: 30 }),
    ]);
    expect(records).toHaveLength(0);
    expect(exceptions).toEqual([
      expect.objectContaining({ sku: 'BK', reason: 'dimension_conflict' }),
      expect.objectContaining({ sku: 'RD', reason: 'dimension_conflict' }),
    ]);
  });

  it('orders a size span numerically, not alphabetically', () => {
    const { records } = buildFedexDimensions([
      row({ sku: 'A', size: '9', length_in: 54, width_in: 8, height_in: 30 }),
      row({ sku: 'B', size: '23', length_in: 54, width_in: 8, height_in: 30 }),
    ]);
    expect(records[0].description).toBe("ALLEGRO A3, 9''-23''");
  });

  it('spans sizes that read as one run', () => {
    const { records } = buildFedexDimensions([
      row({ sku: 'A', size: '15', length_in: 54, width_in: 8, height_in: 30 }),
      row({ sku: 'B', size: '17', length_in: 54, width_in: 8, height_in: 30 }),
      row({ sku: 'C', size: '19', length_in: 54, width_in: 8, height_in: 30 }),
    ]);
    expect(records[0].description).toBe("ALLEGRO A3, 15''-19''");
  });

  it('lists sizes in full when the group mixes size forms', () => {
    // L14''-L16'' would hide the plain 15'' sitting between two low-step frames.
    const { records } = buildFedexDimensions([
      row({ sku: 'A', model: 'ALLEGRO A2', size: 'L14', length_in: 54, width_in: 8, height_in: 30 }),
      row({ sku: 'B', model: 'ALLEGRO A2', size: '15', length_in: 54, width_in: 8, height_in: 30 }),
      row({ sku: 'C', model: 'ALLEGRO A2', size: 'L16', length_in: 54, width_in: 8, height_in: 30 }),
    ]);
    expect(records).toHaveLength(1);
    expect(records[0].description).toBe("ALLEGRO A2, L14''/15''/L16''");
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

describe('buildFedexDimensions — cross-model merge (Rafael, 16 sep 2026)', () => {
  it('merges two models with the exact same box into one record', () => {
    const { records } = buildFedexDimensions([
      row({ sku: 'A1', model: 'CITIZEN 1', size: '15', length_in: 56, width_in: 9, height_in: 31 }),
      row({ sku: 'B1', model: 'QUEST A3', size: '17', length_in: 56, width_in: 9, height_in: 31 }),
    ]);
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ length: 56, width: 31, height: 9 });
    expect(records[0].skus).toEqual(['A1', 'B1']);
  });

  it('carries both model names in the id', () => {
    const { records } = buildFedexDimensions([
      row({ sku: 'A1', model: 'CITIZEN 1', size: '15', length_in: 56, width_in: 9, height_in: 31 }),
      row({ sku: 'B1', model: 'QUEST A3', size: '17', length_in: 56, width_in: 9, height_in: 31 }),
    ]);
    expect(records[0].id).toMatch(/CITIZEN/);
    expect(records[0].id).toMatch(/QUEST/);
    expect(records[0].id).toMatch(/^[A-Z0-9]+$/);
    expect(records[0].id.length).toBeLessThanOrEqual(30);
  });

  it('joins model descriptions with / in the description field', () => {
    const { records } = buildFedexDimensions([
      row({ sku: 'A1', model: 'CITIZEN 1', size: '15', length_in: 56, width_in: 9, height_in: 31 }),
      row({ sku: 'B1', model: 'QUEST A3', size: '17', length_in: 56, width_in: 9, height_in: 31 }),
    ]);
    expect(records[0].description).toContain(' / ');
  });

  it('orders models by SKU count descending so the dominant leads', () => {
    const { records } = buildFedexDimensions([
      // QUEST has 3 SKUs, CITIZEN has 1 — QUEST should lead.
      row({ sku: 'A1', model: 'CITIZEN 1', size: '15', length_in: 56, width_in: 9, height_in: 31 }),
      row({ sku: 'B1', model: 'QUEST A3', size: '15', length_in: 56, width_in: 9, height_in: 31 }),
      row({ sku: 'B2', model: 'QUEST A3', size: '17', length_in: 56, width_in: 9, height_in: 31 }),
      row({ sku: 'B3', model: 'QUEST A3', size: '19', length_in: 56, width_in: 9, height_in: 31 }),
    ]);
    expect(records).toHaveLength(1);
    expect(records[0].id).toMatch(/^QUESTA3/);
    expect(records[0].description).toMatch(/^QUEST A3/);
  });

  it('splits a row when the combined models overflow MAX_ID (30 chars)', () => {
    // Three models whose id parts total well over 30 characters.
    const { records } = buildFedexDimensions([
      row({ sku: 'A1', model: 'RENEGADE EXPLORE', size: '58', length_in: 56, width_in: 9, height_in: 31 }),
      row({ sku: 'A2', model: 'RENEGADE EXPLORE', size: '54', length_in: 56, width_in: 9, height_in: 31 }),
      row({ sku: 'B1', model: 'VENTURA COMP', size: '58', length_in: 56, width_in: 9, height_in: 31 }),
      row({ sku: 'C1', model: 'CITIZEN BASIC', size: '15', length_in: 56, width_in: 9, height_in: 31 }),
    ]);
    // All rows should carry the same dimensions.
    expect(records.length).toBeGreaterThan(1);
    for (const r of records) {
      expect(r).toMatchObject({ length: 56, width: 31, height: 9 });
      expect(r.id.length).toBeLessThanOrEqual(30);
      // Every id must carry at least one model name — never bare dimensions.
      expect(r.id).toMatch(/[A-Z]{3,}/);
    }
    // All SKUs must be present across all split rows, with NO duplicates.
    const allSkus = records.flatMap((r) => r.skus);
    expect(allSkus).toHaveLength(new Set(allSkus).size);
    expect([...new Set(allSkus)].sort()).toEqual(['A1', 'A2', 'B1', 'C1']);
  });

  it('no SKU appears in more than one record after a split', () => {
    // Five models that force at least three chunks — enough to expose the
    // bug where every chunk carried the whole bucket's SKUs.
    const { records, exceptions } = buildFedexDimensions([
      row({ sku: 'S1', model: 'EXPLORER SO', size: '18', length_in: 56, width_in: 9, height_in: 31 }),
      row({ sku: 'S2', model: 'EXPLORER A', size: '21', length_in: 56, width_in: 9, height_in: 31 }),
      row({ sku: 'S3', model: 'CODA S2', size: '15', length_in: 56, width_in: 9, height_in: 31 }),
      row({ sku: 'S4', model: 'CODA S2', size: '17', length_in: 56, width_in: 9, height_in: 31 }),
      row({ sku: 'S5', model: 'RENEGADE COMP', size: '58', length_in: 56, width_in: 9, height_in: 31 }),
      row({ sku: 'S6', model: 'VENTURA BASIC', size: '15', length_in: 56, width_in: 9, height_in: 31 }),
    ]);
    const allSkus = records.flatMap((r) => r.skus);
    const exSkus = exceptions.map((e) => e.sku);
    // No duplicates across records.
    expect(allSkus).toHaveLength(new Set(allSkus).size);
    // Every input SKU must appear exactly once across records + exceptions.
    const total = new Set([...allSkus, ...exSkus]);
    expect(total).toEqual(new Set(['S1', 'S2', 'S3', 'S4', 'S5', 'S6']));
  });

  it("each chunk's SKUs belong to the models named in that chunk", () => {
    // Two models that cannot share a 30-char id — each gets its own chunk.
    const { records } = buildFedexDimensions([
      row({ sku: 'M1A', model: 'RENEGADE EXPLORE', size: '54', length_in: 56, width_in: 9, height_in: 31 }),
      row({ sku: 'M1B', model: 'RENEGADE EXPLORE', size: '58', length_in: 56, width_in: 9, height_in: 31 }),
      row({ sku: 'M2A', model: 'VENTURA COMFORT XL', size: '15', length_in: 56, width_in: 9, height_in: 31 }),
    ]);
    expect(records.length).toBeGreaterThanOrEqual(2);
    // The chunk whose id contains RENEGADE must not carry M2A, and vice-versa.
    for (const r of records) {
      if (r.id.includes('RENEGADE')) {
        expect(r.skus).not.toContain('M2A');
        expect(r.skus.some((s) => s.startsWith('M1'))).toBe(true);
      }
      if (r.id.includes('VENTURA')) {
        expect(r.skus).not.toContain('M1A');
        expect(r.skus).not.toContain('M1B');
        expect(r.skus).toContain('M2A');
      }
    }
  });

  it('does not merge different boxes even from the same model', () => {
    const { records } = buildFedexDimensions([
      row({ sku: 'A', model: 'ALLEGRO A3', size: '15', length_in: 54, width_in: 8, height_in: 30 }),
      row({ sku: 'B', model: 'ALLEGRO A3', size: '23', length_in: 56, width_in: 8, height_in: 30 }),
    ]);
    expect(records).toHaveLength(2);
  });

  it('does not merge different boxes from different models', () => {
    const { records } = buildFedexDimensions([
      row({ sku: 'A', model: 'CITIZEN 1', size: '15', length_in: 54, width_in: 8, height_in: 30 }),
      row({ sku: 'B', model: 'DXT A2', size: '15', length_in: 56, width_in: 9, height_in: 31 }),
    ]);
    expect(records).toHaveLength(2);
  });
});

describe('buildFedexDimensions — model dedup in id (Rafael, 16 sep 2026)', () => {
  it('names the model once when two cubes of the same model share a box', () => {
    const { records } = buildFedexDimensions([
      row({ sku: 'A', model: 'ALLEGRO A3', size: '15', length_in: 54, width_in: 8, height_in: 30 }),
      row({ sku: 'B', model: 'ALLEGRO A3', size: '17', length_in: 54, width_in: 8, height_in: 30 }),
    ]);
    expect(records).toHaveLength(1);
    // The model appears exactly once — no ALLEGROA3…ALLEGROA3… duplication.
    expect(records[0].id.match(/ALLEGROA3/g)).toHaveLength(1);
  });

  it('keeps only the shortest prefix model: ALLEGRO A3, not ALLEGRO A3 S/O', () => {
    const { records } = buildFedexDimensions([
      row({ sku: 'A', model: 'ALLEGRO A3', size: '15', length_in: 54, width_in: 8, height_in: 30 }),
      row({ sku: 'B', model: 'ALLEGRO A3 S/O', size: '14', length_in: 54, width_in: 8, height_in: 30 }),
    ]);
    expect(records).toHaveLength(1);
    expect(records[0].id).toBe('ALLEGROA3');
    expect(records[0].id).not.toContain('SO');
  });

  it('lists both models when they share no word-prefix', () => {
    const { records } = buildFedexDimensions([
      row({ sku: 'A', model: 'CITIZEN 1', size: '15', length_in: 56, width_in: 9, height_in: 31 }),
      row({ sku: 'B', model: 'QUEST A3', size: '17', length_in: 56, width_in: 9, height_in: 31 }),
    ]);
    expect(records).toHaveLength(1);
    expect(records[0].id).toMatch(/CITIZEN/);
    expect(records[0].id).toMatch(/QUEST/);
  });

  it('shows both full model names with sizes in description even when the id is collapsed', () => {
    const { records } = buildFedexDimensions([
      row({ sku: 'A', model: 'ALLEGRO A3', size: '15', length_in: 54, width_in: 8, height_in: 30 }),
      row({ sku: 'B', model: 'ALLEGRO A3 S/O', size: '14', length_in: 54, width_in: 8, height_in: 30 }),
    ]);
    expect(records).toHaveLength(1);
    expect(records[0].description).toContain('ALLEGRO A3');
    expect(records[0].description).toContain('S/O');
    expect(records[0].description).toContain("15''");
    expect(records[0].description).toContain("14''");
  });
});

describe('toFsmCsv', () => {
  const built = buildFedexDimensions([
    row({ sku: 'A', model: 'ALLEGRO A3', size: '19', length_in: 54.75, width_in: 8.25, height_in: 30.5 }),
    row({ sku: 'B', model: 'ALLEGRO A3', size: '21', length_in: 54.5, width_in: 8.5, height_in: 30.75 }),
  ]);

  it('writes Description, ID, Height, Length, Width with every field quoted', () => {
    expect(toFsmCsv(built.records)).toBe('"ALLEGRO A3, 19\'\'-21\'\'","ALLEGROA31921","9","55","31"\r\n');
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
