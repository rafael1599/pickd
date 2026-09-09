import { describe, it, expect } from 'vitest';
import { parseSheetRows } from '../parseShipmentXlsx';

/**
 * Rows as `sheet_to_json({header: 1})` hands them over, from a JAMIS
 * "NJ Breakdown" sheet: A PO marker · B Units Inv'd · C/D/E the SKU in three
 * cells · F Model · G Size · H Colour.
 */
const ROWS = [
  ['', '', 'SKU #', '', '', 'Model', 'Size', 'Color'],
  ['6430N', null, null, null, null, null, null, null],
  [null, 10, '03', 3986, 'TL', 'DXT A3', '19', 'Teal'],
  [null, 200, '07', 3742, 'BK', 'Laser 1.6', null, 'Gloss Black'],
  [null, 12, '12', 8341, 'BL', 'Taxi Part Chainguard 24', null, null],
  [null, 0, null, 2065, null, 'Notes:', null, null],
];

describe('parseSheetRows', () => {
  it('keeps the three columns the sheet already split', () => {
    const [dxt] = parseSheetRows(ROWS);
    expect(dxt.sku).toBe('03-3986TL');
    expect(dxt.model).toBe('DXT A3');
    expect(dxt.size).toBe('19');
    expect(dxt.color).toBe('Teal');
    // register_new_sku writes model/size/color; the joined name is the label.
    expect(dxt.itemName).toBe('DXT A3 19 Teal');
  });

  it('leaves an empty cell null instead of guessing at the join', () => {
    const laser = parseSheetRows(ROWS).find((i) => i.sku === '07-3742BK');
    // The September container: no size on the sheet, and "Laser 1.6" is the
    // model — reading it back out of "Laser 1.6 Gloss Black" is the guesswork
    // this exists to avoid.
    expect(laser).toMatchObject({ model: 'Laser 1.6', size: null, color: 'Gloss Black' });
    expect(laser?.itemName).toBe('Laser 1.6 Gloss Black');
  });

  it('tags every line with its PO and skips the totals row', () => {
    const items = parseSheetRows(ROWS);
    expect(items).toHaveLength(3);
    expect(items.every((i) => i.po === '6430N')).toBe(true);
    expect(items.some((i) => String(i.sku).includes('2065'))).toBe(false);
  });
});
