import { describe, it, expect } from 'vitest';
import { parseSheetContainers, parseSheetRows } from '../parseShipmentXlsx';
import { groupContainers } from '../containers';

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

/**
 * The top of "(100) Shipment Schedule- 8.28.26.xlsx", NJ Breakdown, as the
 * sheet has it -- six containers in one sheet, which Rafael cut into six files
 * by hand to register them (10 Sep 2026). Two lines per container are enough
 * to show where one ends and the next begins.
 */
const NJ_BREAKDOWN = [
  ['Jamis North Shipment Detail', null, null, null, null, null, null, null, null],
  [null, null, null, null, null, null, null, null, null],
  ["Units\nRec'd", "Units\nInv'd", 'SKU #', null, null, 'Model', 'Size', 'Color', 'BIN'],
  ['7005N', ' ', ' ', 'EVER BIRTH', null, 'TXGU5768052', ' ', ' ', null],
  [null, 20, '03', 4703, 'GY', 'Renegade S3', 51, 'Primer Grey', null],
  [null, 44, '03', 4704, 'GY', 'Renegade S3', 54, 'Primer Grey', null],
  ['6436N', ' ', ' ', 'EVER MASS', null, 'EGHU9511093', ' ', ' ', null],
  [null, 5, '03', 2974, 'SL', 'Citizen 3 Step-Thru', 18, 'Nickel', null],
  [null, 26, '06', 4456, 'BL', 'Boss Cruiser CB', 21, 'Cosmo Blue', null],
  ['6437N', ' ', ' ', 'EVER MAST ', null, 'EGHU9511093', ' ', ' ', null],
  [null, 35, '03', 3989, 'GY', 'Citizen 2 Step-Thru', 16, 'Storm Grey', null],
  [null, 2, '06', 4491, 'TL', 'Earth Cruiser 2 Step-Thru', 17, 'Radiant Teal', null],
];

describe('parseSheetContainers', () => {
  it('reads one container per section row, not one per sheet', () => {
    const containers = parseSheetContainers(NJ_BREAKDOWN, 'NJ Breakdown');
    expect(containers.map((c) => c.po)).toEqual(['7005N', '6436N', '6437N']);
    expect(containers.map((c) => c.total)).toEqual([64, 31, 37]);
    // 03-3989GY is in 6436N and 6437N on the real sheet; here it is only in
    // the one it is listed under.
    expect(containers[2].items.map((i) => i.sku)).toEqual(['03-3989GY', '06-4491TL']);
  });

  it('keeps the vessel and the box number the section row names', () => {
    const [first, , third] = parseSheetContainers(NJ_BREAKDOWN, 'NJ Breakdown');
    expect(first).toMatchObject({
      sheet: 'NJ Breakdown',
      vessel: 'EVER BIRTH',
      containerIds: ['TXGU5768052'],
    });
    expect(third.vessel).toBe('EVER MAST'); // the sheet's trailing space is gone
  });

  it('reads the FL sheet, where the vessel sits in column B', () => {
    const [fl] = parseSheetContainers(
      [
        ['PO#', 'Units', 'SKU #', null, null, 'Model', 'Size', 'Color'],
        ['6438F', 'EVER VERSE', null, null, null, 'EMCU8323455', ' ', ' '],
        [null, 72, '03', 3986, 'TL', 'Citizen 2 Step-Thru', 14, 'Radiant Teal'],
      ],
      'FL Breakdown'
    );
    expect(fl).toMatchObject({ po: '6438F', vessel: 'EVER VERSE', total: 72 });
  });

  it('takes a two-letter PO (Direct Containers)', () => {
    const [direct] = parseSheetContainers(
      [
        ['PO#', 'Units', 'SKU #', null, null, 'Model', 'Size', 'Color'],
        ['6433FL', ' ', ' ', 'GSL CHLOE', null, 'FDCU0460460', ' ', ' '],
        [null, 301, '06', 4627, 'LDV', 'Taxi 26" Step-Over', 18, 'Carolina Blue'],
      ],
      'Direct Containers'
    );
    expect(direct.po).toBe('6433FL');
    expect(direct.items[0].po).toBe('6433FL');
  });

  it('gives lines above the first section row a container with no PO', () => {
    const [orphan] = parseSheetContainers(
      [
        ['', '', 'SKU #'],
        [null, 3, '03', 4703, 'GY', 'Renegade S3', 51, 'Primer Grey'],
      ],
      'Sheet1'
    );
    expect(orphan).toMatchObject({ po: null, total: 3 });
  });
});

describe('groupContainers', () => {
  it('makes one container of a PO that fills two boxes', () => {
    // The Direct sheet lists 6433FL twice, once per box, 301 bikes each.
    const sheet = parseSheetContainers(
      [
        ['PO#', 'Units', 'SKU #', null, null, 'Model', 'Size', 'Color'],
        ['6433FL', ' ', ' ', 'GSL CHLOE', null, 'FDCU0460460', ' ', ' '],
        [null, 301, '06', 4627, 'LDV', 'Taxi 26" Step-Over', 18, 'Carolina Blue'],
        ['6433FL', ' ', ' ', 'GSL CHLOE', null, 'SEKU4418121', ' ', ' '],
        [null, 301, '06', 4627, 'LDV', 'Taxi 26" Step-Over', 18, 'Carolina Blue'],
      ],
      'Direct Containers'
    );
    const grouped = groupContainers(sheet);
    expect(grouped).toHaveLength(1);
    expect(grouped[0]).toMatchObject({
      po: '6433FL',
      total: 602,
      containerIds: ['FDCU0460460', 'SEKU4418121'],
    });
    expect(grouped[0].items).toHaveLength(2); // resolve_container_skus sums them
  });

  it('never merges two blocks without a PO, and drops empty sections', () => {
    const grouped = groupContainers([
      { po: null, sheet: 'A', vessel: null, containerIds: [], items: [], total: 0 },
      ...parseSheetContainers([[null, 3, '03', 4703, 'GY', 'R', 51, 'G']], 'A'),
      ...parseSheetContainers([[null, 4, '03', 4704, 'GY', 'R', 54, 'G']], 'B'),
    ]);
    expect(grouped.map((c) => [c.sheet, c.po, c.total])).toEqual([
      ['A', null, 3],
      ['B', null, 4],
    ]);
  });
});
