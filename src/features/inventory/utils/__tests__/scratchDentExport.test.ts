import { describe, expect, it } from 'vitest';
import {
  buildScratchDentExportRows,
  scratchDentExportFileName,
  type ScratchDentInventoryRow,
  type ScratchDentMetadataRow,
} from '../scratchDentExport';

const inv = (over: Partial<ScratchDentInventoryRow> = {}): ScratchDentInventoryRow => ({
  id: 1,
  warehouse: 'LUDLOW',
  location: 'ROW 20',
  sublocation: ['F'],
  quantity: 1,
  is_active: true,
  item_name: 'S/D EXPLORER A1 2022 17 BLUE',
  internal_note: null,
  created_at: '2026-04-17T10:00:00Z',
  updated_at: '2026-09-01T12:00:00Z',
  ...over,
});

const meta = (over: Partial<ScratchDentMetadataRow> = {}): ScratchDentMetadataRow => ({
  sku: '01-0288',
  model: 'EXPLORER A1',
  size: '17"',
  color: 'BLUE',
  category: 'bike',
  sd_category: 'sd',
  condition: 'scratch',
  condition_description: 'Scuffed top tube',
  serial_number: 'SN123',
  upc: null,
  msrp: 899,
  standard_price: 600,
  sd_price: 450,
  as400_description: 'S/D EXPLORER A1',
  received_year: 2022,
  weight_lbs: 45,
  length_in: 55,
  width_in: 8.5,
  height_in: 30.5,
  dimensions_verified: false,
  weight_verified: false,
  image_url: null,
  pdf_link: null,
  created_at: '2026-04-17T10:00:00Z',
  inventory: [inv()],
  ...over,
});

describe('buildScratchDentExportRows', () => {
  it('writes one row per live shelf row with catalogue and shelf side by side', () => {
    const [row] = buildScratchDentExportRows([meta()], { includeInactive: false });
    expect(row).toMatchObject({
      SKU: '01-0288',
      Name: 'S/D EXPLORER A1 2022 17 BLUE',
      Condition: 'scratch',
      'S/D price': 450,
      Location: 'ROW 20',
      Square: 'F',
      Qty: 1,
      Status: 'In stock',
      'Middle side (in)': 30.5,
      'Thinnest side (in)': 8.5,
      'Last change': '2026-09-01',
    });
  });

  it('leaves sold units and shelf-less SKUs out unless Deleted & Qty 0 is on', () => {
    const data = [
      meta({ sku: 'A', inventory: [inv({ quantity: 0, is_active: false })] }),
      meta({ sku: 'B', inventory: [] }),
      meta({ sku: 'C', inventory: [inv({ warehouse: 'ATS' })] }),
    ];
    expect(buildScratchDentExportRows(data, { includeInactive: false })).toEqual([]);
    const all = buildScratchDentExportRows(data, { includeInactive: true });
    expect(all.map((r) => [r.SKU, r.Status])).toEqual([
      ['B', 'Sold / 0'],
      ['A', 'Sold / 0'],
    ]);
  });

  it('sorts by location the way the floor reads it', () => {
    const data = [
      meta({ sku: 'X', inventory: [inv({ location: 'ROW 24' })] }),
      meta({ sku: 'Y', inventory: [inv({ location: 'ROW 3' })] }),
    ];
    expect(buildScratchDentExportRows(data, { includeInactive: false }).map((r) => r.SKU)).toEqual([
      'Y',
      'X',
    ]);
  });
});

it('names the file by date', () => {
  expect(scratchDentExportFileName(new Date(2026, 8, 30))).toBe('SD_BIKES_20260930.xlsx');
});
